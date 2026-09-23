import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword } from '../src/services/authService.js';
import { Role, AccountStatus } from '@prisma/client';
import { env } from '../src/config/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import authRoutes from '../src/routes/authRoutes.js';

describe('Auth Controller - Refresh Token Reuse Detection', () => {
  let testUser: { email: string; password: string; firstName: string; lastName: string };
  let passwordHash: string;
  let userId: string;
  let app: express.Express;

  beforeEach(async () => {
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