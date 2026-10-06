import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Authenticator } from '@otplib/core';
import { createDigest, createRandomBytes } from '@otplib/plugin-crypto';
import { keyDecoder, keyEncoder } from '@otplib/plugin-thirty-two';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword } from '../src/services/authService.js';
import { Role, AccountStatus } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import authRoutes from '../src/routes/authRoutes.js';

function currentCode(secret: string): string {
  return new Authenticator({
    createDigest,
    createRandomBytes,
    keyDecoder,
    keyEncoder,
    step: 30,
    epoch: Date.now(),
    window: 0,
  }).generate(secret);
}

describe('Two-factor authentication HTTP flow', () => {
  let testUser: { email: string; password: string };
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

  async function loginDirectly() {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password });
    return { status: res.status, body: res.body, cookie: res.headers['set-cookie'] };
  }

  async function enableViaApi() {
    const { cookie, body } = await loginDirectly();
    expect(cookie).toBeDefined();

    const setup = await request(app)
      .post('/api/auth/2fa/setup')
      .set('Cookie', cookie)
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .send({ password: testUser.password });
    expect(setup.status).toBe(200);

    const enable = await request(app)
      .post('/api/auth/2fa/enable')
      .set('Cookie', cookie)
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .send({ code: currentCode(setup.body.data.secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.data.recoveryCodes).toHaveLength(10);

    return { setup, enable, cookie, accessToken: body.data.accessToken };
  }

  it('reports the new flags on /me after enrollment', async () => {
    const { cookie } = await enableViaApi();

    // The pre-enrollment session survived (keepSessionId), so it can refresh.
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(200);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${refresh.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user).toMatchObject({ id: userId, twoFactorEnabled: true, twoFactorPending: false });
  });

  it('reports enrollment progress on /2fa/status', async () => {
    const login = await loginDirectly();
    const auth = {
      Cookie: login.cookie as string,
      Authorization: `Bearer ${login.body.data.accessToken}`,
    };

    const before = await request(app).get('/api/auth/2fa/status').set(auth);
    expect(before.status).toBe(200);
    expect(before.body.data).toEqual({ twoFactorEnabled: false, setupPending: false });

    const setup = await request(app)
      .post('/api/auth/2fa/setup')
      .set(auth)
      .send({ password: testUser.password });
    expect(setup.status).toBe(200);

    const pending = await request(app).get('/api/auth/2fa/status').set(auth);
    expect(pending.status).toBe(200);
    expect(pending.body.data).toEqual({ twoFactorEnabled: false, setupPending: true });

    const enable = await request(app)
      .post('/api/auth/2fa/enable')
      .set(auth)
      .send({ code: currentCode(setup.body.data.secret) });
    expect(enable.status).toBe(200);

    const after = await request(app).get('/api/auth/2fa/status').set(auth);
    expect(after.status).toBe(200);
    expect(after.body.data).toEqual({ twoFactorEnabled: true, setupPending: false });
  });

  it('answers a normal login with a challenge, then completes it with a TOTP code', async () => {
    const { setup } = await enableViaApi();

    const login = await loginDirectly();
    expect(login.status).toBe(200);
    expect(login.body.data.requiresTwoFactor).toBe(true);
    expect(login.body.data.challengeToken).toBeTruthy();
    expect(login.cookie).toBeUndefined();
    expect(login.body.data.accessToken).toBeUndefined();

    // The challenge needs a second factor even for the same account.
    const wrong = await request(app)
      .post('/api/auth/2fa/challenge')
      .send({ challengeToken: login.body.data.challengeToken, code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('MFA_CHALLENGE_INVALID');

    // The real code signs in like a normal login: access token + cookie.
    const complete = await request(app)
      .post('/api/auth/2fa/challenge')
      .send({ challengeToken: login.body.data.challengeToken, code: currentCode(setup.body.data.secret) });
    expect(complete.status).toBe(200);
    expect(complete.body.data.accessToken).toBeTruthy();
    expect(complete.headers['set-cookie']).toBeDefined();
    expect(complete.body.data.user).toMatchObject({ id: userId, twoFactorEnabled: true });
  });

  it('logs in with a recovery code, accepting sloppy input', async () => {
    const { enable } = await enableViaApi();

    const login = await loginDirectly();
    expect(login.body.data.requiresTwoFactor).toBe(true);

    const sloppy = enable.body.data.recoveryCodes[0].toLowerCase().replace(/-/g, '');
    const complete = await request(app)
      .post('/api/auth/2fa/recovery')
      .send({ challengeToken: login.body.data.challengeToken, recoveryCode: sloppy });
    expect(complete.status).toBe(200);
    expect(complete.body.data.accessToken).toBeTruthy();
  });

  it('returns to a normal login after 2FA is disabled', async () => {
    const { setup, cookie, accessToken } = await enableViaApi();

    const badCode = await request(app)
      .post('/api/auth/2fa/disable')
      .set('Cookie', cookie)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: testUser.password, code: '000000' });
    expect(badCode.status).toBe(400);
    expect(badCode.body.error.code).toBe('MFA_CODE_INVALID');

    const offlineDisable = await request(app)
      .post('/api/auth/2fa/disable')
      .set('Cookie', cookie)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: testUser.password, code: currentCode(setup.body.data.secret) });
    expect(offlineDisable.status).toBe(200);

    const login = await loginDirectly();
    expect(login.status).toBe(200);
    expect(login.body.data.requiresTwoFactor).toBeUndefined();
    expect(login.body.data.accessToken).toBeTruthy();
  });
});