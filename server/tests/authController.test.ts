import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { ipKeyGenerator } from 'express-rate-limit';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword } from '../src/services/authService.js';
import { Role, AccountStatus } from '@prisma/client';
import { env } from '../src/config/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { authRateLimit } from '../src/middleware/rateLimit.js';
import authRoutes from '../src/routes/authRoutes.js';

const CLIENT_KEYS = ['127.0.0.1', '::1'].map((ip) => ipKeyGenerator(ip, 56));

describe('Auth Controller - Refresh Token Reuse Detection', () => {
  let testUser: { email: string; password: string; firstName: string; lastName: string };
  let passwordHash: string;
  let userId: string;
  let app: express.Express;

  beforeEach(async () => {
    // Every auth route sits behind the per-IP auth limiter (20 requests per
    // window outside development). Tests share one client IP while each one
    // creates a fresh user, so the IP bucket is reset here. The limiter's own
    // behaviour is asserted in rateLimit.test.ts, not by this file.
    for (const key of CLIENT_KEYS) {
      authRateLimit.resetKey(key);
    }

    testUser = createTestUser();
    passwordHash = await hashPassword(testUser.password);

    const user = await testPrisma.user.create({
      data: {
        email: testUser.email,
        passwordHash,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        role: Role.USER,
        status: AccountStatus.ACTIVE,
      },
    });
    userId = user.id;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRoutes);
    app.use(errorHandler);
  });

  async function loginAndGetTokens() {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password });

    expect(loginRes.status).toBe(200);
    const accessToken = loginRes.body.data.accessToken;
    const refreshCookie = loginRes.headers['set-cookie'];
    return { accessToken, refreshCookie };
  }

  it('should successfully refresh with valid token', async () => {
    const { accessToken, refreshCookie } = await loginAndGetTokens();

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
  });

  it('should refuse to refresh a suspended account without rotating the session', async () => {
    const { refreshCookie } = await loginAndGetTokens();

    await testPrisma.user.update({
      where: { id: userId },
      data: { status: AccountStatus.SUSPENDED },
    });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    // The rejection happens before rotation: no new refresh cookie, and the
    // session row keeps its original refresh token.
    expect(res.headers['set-cookie']).toBeUndefined();

    await testPrisma.user.update({
      where: { id: userId },
      data: { status: AccountStatus.ACTIVE },
    });

    const afterReactivation = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);

    expect(afterReactivation.status).toBe(200);
    expect(afterReactivation.body.success).toBe(true);
    expect(afterReactivation.body.data.accessToken).toBeDefined();
  });

  it('should refuse to refresh a deactivated account', async () => {
    const { refreshCookie } = await loginAndGetTokens();

    await testPrisma.user.update({
      where: { id: userId },
      data: { status: AccountStatus.DEACTIVATED },
    });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('should reject old refresh token after rotation (reuse detection)', async () => {
    const { refreshCookie } = await loginAndGetTokens();

    // First refresh - should succeed
    const firstRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);

    expect(firstRefresh.status).toBe(200);
    const newRefreshCookie = firstRefresh.headers['set-cookie'];

    // Second refresh with old cookie - should fail with reuse detection
    const secondRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);

    expect(secondRefresh.status).toBe(401);
    expect(secondRefresh.body.success).toBe(false);
    expect(secondRefresh.body.error.code).toBe('TOKEN_REVOKED');
    expect(secondRefresh.body.error.message).toContain('Token reuse detected');
  });

  it('should revoke entire token family on reuse detection', async () => {
    const { refreshCookie } = await loginAndGetTokens();

    // First refresh
    const firstRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);
    expect(firstRefresh.status).toBe(200);
    const secondRefreshCookie = firstRefresh.headers['set-cookie'];

    // Second refresh with new token - should succeed
    const secondRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', secondRefreshCookie);
    expect(secondRefresh.status).toBe(200);
    const thirdRefreshCookie = secondRefresh.headers['set-cookie'];

    // Third refresh with original (revoked) token - should fail
    const thirdRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);
    expect(thirdRefresh.status).toBe(401);
    expect(thirdRefresh.body.error.code).toBe('TOKEN_REVOKED');

    // Even the second token should now be revoked (family revoked)
    const fourthRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', secondRefreshCookie);
    expect(fourthRefresh.status).toBe(401);
    expect(fourthRefresh.body.error.code).toBe('TOKEN_REVOKED');

    // But the third (latest) token was in the same family and is also revoked
    const fifthRefresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', thirdRefreshCookie);
    expect(fifthRefresh.status).toBe(401);
    expect(fifthRefresh.body.error.code).toBe('TOKEN_REVOKED');
  });

  it('should allow only one of two concurrent refreshes with the same cookie to succeed', async () => {
    const { refreshCookie } = await loginAndGetTokens();

    // Both requests present the SAME refresh cookie at the same time.
    // No request ordering is assumed: exactly one must win.
    const [first, second] = await Promise.all([
      request(app).post('/api/auth/refresh').set('Cookie', refreshCookie),
      request(app).post('/api/auth/refresh').set('Cookie', refreshCookie),
    ]);

    const responses = [first, second];
    const successes = responses.filter((res) => res.status === 200);
    const rejections = responses.filter((res) => res.status === 401);

    // Exactly one successful consumption of the old refresh token.
    expect(successes.length).toBe(1);
    expect(rejections.length).toBe(1);

    // The loser follows the existing reuse-detection semantics.
    const rejected = rejections[0];
    expect(rejected.body.success).toBe(false);
    expect(rejected.body.error.code).toBe('TOKEN_REVOKED');
    expect(rejected.body.error.message).toContain('Token reuse detected');

    // The winner got a rotated cookie.
    const winnerCookie = successes[0].headers['set-cookie'];
    expect(winnerCookie).toBeDefined();

    // Family-revocation post-condition: because a reuse was observed, the
    // whole token family is revoked — the winner's freshly minted token is
    // dead too, so neither the old token nor its successor can be replayed.
    const afterFamilyRevoke = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', winnerCookie);
    expect(afterFamilyRevoke.status).toBe(401);
    expect(afterFamilyRevoke.body.error.code).toBe('TOKEN_REVOKED');

    const replayOldToken = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);
    expect(replayOldToken.status).toBe(401);
    expect(replayOldToken.body.error.code).toBe('TOKEN_REVOKED');
    expect(replayOldToken.body.error.message).toContain('Token reuse detected');

    // No second successor may exist: exactly one rotation happened, so the
    // database holds the original session plus exactly one successor.
    const familySessions = await testPrisma.session.findMany({});
    const successors = familySessions.filter(
      (row) => row.previousRefreshTokenHash !== null
    );
    expect(successors.length).toBe(1);
    expect(familySessions.length).toBe(2);
  });

  it('should not log raw cookies or tokens', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { refreshCookie } = await loginAndGetTokens();

    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);

    // Check that no raw cookies or tokens were logged
    const allLogs = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls].flat();
    const logString = JSON.stringify(allLogs);

    expect(logString).not.toContain('wh_refresh_token');
    expect(logString).not.toContain(refreshCookie[0]?.split('=')[1]?.split(';')[0] || '');

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});