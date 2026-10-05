import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { ipKeyGenerator } from 'express-rate-limit';
import { AuthTokenType, Role, AccountStatus } from '@prisma/client';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword } from '../src/services/authService.js';
import { AuditActions } from '../src/services/auditLogService.js';
import { authRateLimit } from '../src/middleware/rateLimit.js';
import {
  clearCapturedEmails,
  getCapturedEmails,
  setEmailTransport,
} from '../src/services/emailService.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import authRoutes from '../src/routes/authRoutes.js';

const GENERIC_RESEND_MESSAGE =
  'If your account requires verification, a verification email has been sent.';
const INVALID_LINK_MESSAGE = 'This verification link is invalid or has expired.';

/** The address supertest presents for every request in this file. */
const CLIENT_KEY = ipKeyGenerator('127.0.0.1', 56);

let app: express.Express;

beforeEach(() => {
  clearCapturedEmails();
  setEmailTransport(null);
  // The auth limiter is a module-level singleton keyed by client IP, so without
  // this one test's requests would spend the next test's budget. The email-keyed
  // login and resend limiters need no reset here because every test uses a fresh
  // address.
  authRateLimit.resetKey(CLIENT_KEY);

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
});

afterEach(() => {
  setEmailTransport(null);
});

async function registerUser(overrides: Partial<ReturnType<typeof createTestUser>> = {}) {
  const payload = { ...createTestUser(), ...overrides };

  const res = await request(app).post('/api/auth/register').send(payload);

  expect(res.status).toBe(201);
  return { res, user: payload };
}

/**
 * Pulls the raw token back out of the link that was actually emailed, so the
 * tests exercise the same token a real recipient would hold rather than one
 * reconstructed from the database.
 */
function tokenFromLastEmail(): string {
  const emails = getCapturedEmails();
  expect(emails.length).toBeGreaterThan(0);

  const link = /verify-email\?token=([0-9a-f]+)/.exec(emails[emails.length - 1].html);
  expect(link, 'verification email did not contain a link').not.toBeNull();

  return link![1];
}

/**
 * Backdates existing verification tokens past the cooldown window. Registration
 * has just minted one, and a resend immediately afterwards is correctly
 * suppressed, so a test that wants the resend to go through has to age it out.
 * The window is derived from the same default the service uses rather than a
 * magic number that could drift from the configured cooldown.
 */
async function ageOutstandingTokens(): Promise<void> {
  await testPrisma.authToken.updateMany({
    data: { createdAt: new Date(Date.now() - 120_000) },
  });
}

async function verify(token: string) {
  return request(app).post('/api/auth/verify-email').send({ token });
}

async function resend(email: string) {
  return request(app).post('/api/auth/resend-verification').send({ email });
}

async function createUnverifiedUser(email = createTestUser().email) {
  const passwordHash = await hashPassword('StrongPassword123!');

  return testPrisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: 'John',
      lastName: 'Doe',
      role: Role.USER,
      status: AccountStatus.ACTIVE,
    },
  });
}

describe('registration issues a verification token', () => {
  it('creates an unverified account and emails a link', async () => {
    const { res, user } = await registerUser();

    expect(res.body.data.user.emailVerified).toBe(false);
    expect(res.body.data.message).toContain('verify');

    const stored = await testPrisma.user.findUnique({ where: { email: user.email } });
    expect(stored?.emailVerifiedAt).toBeNull();

    const tokens = await testPrisma.authToken.findMany({
      where: { userId: stored!.id, type: AuthTokenType.EMAIL_VERIFICATION },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].usedAt).toBeNull();

    const emails = getCapturedEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe(user.email);
  });

  it('stores only a hash, never the raw token', async () => {
    const { user } = await registerUser();
    const rawToken = tokenFromLastEmail();

    const stored = await testPrisma.authToken.findFirst({
      where: { userId: (await testPrisma.user.findUniqueOrThrow({ where: { email: user.email } })).id },
    });

    expect(stored!.tokenHash).not.toBe(rawToken);
    expect(stored!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records EMAIL_VERIFICATION_SENT without leaking the token', async () => {
    const { user } = await registerUser();
    const rawToken = tokenFromLastEmail();

    const audit = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.EMAIL_VERIFICATION_SENT },
    });

    expect(audit).toHaveLength(1);
    expect(audit[0].entityId).toBe((await testPrisma.user.findUniqueOrThrow({ where: { email: user.email } })).id);

    const serialized = JSON.stringify(audit[0].metadata);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain('verify-email?');
  });

  it('still succeeds when the mail transport fails', async () => {
    setEmailTransport({
      name: 'failing',
      send: async () => {
        throw new Error('provider unavailable');
      },
    });

    const payload = createTestUser();
    const res = await request(app).post('/api/auth/register').send(payload);

    expect(res.status).toBe(201);
    const stored = await testPrisma.user.findUnique({ where: { email: payload.email } });
    expect(stored).not.toBeNull();
    expect(stored!.emailVerifiedAt).toBeNull();
  });
});

describe('POST /api/auth/verify-email', () => {
  it('marks the address verified on a valid token', async () => {
    const { user } = await registerUser();

    const res = await verify(tokenFromLastEmail());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.emailVerified).toBe(true);

    const stored = await testPrisma.user.findUniqueOrThrow({ where: { email: user.email } });
    expect(stored.emailVerifiedAt).not.toBeNull();
  });

  it('consumes the token so it cannot be replayed', async () => {
    await registerUser();
    const rawToken = tokenFromLastEmail();

    expect((await verify(rawToken)).status).toBe(200);

    const replay = await verify(rawToken);
    expect(replay.status).toBe(400);
    expect(replay.body.error.message).toBe(INVALID_LINK_MESSAGE);

    const token = await testPrisma.authToken.findFirstOrThrow({
      where: { tokenHash: (await import('../src/services/authTokenService.js')).hashAuthToken(rawToken) },
    });
    expect(token.usedAt).not.toBeNull();
  });

  it('reports EMAIL_VERIFIED exactly once for a replayed token', async () => {
    const { user } = await registerUser();
    const rawToken = tokenFromLastEmail();

    await verify(rawToken);
    const firstStamp = (await testPrisma.user.findUniqueOrThrow({ where: { email: user.email } }))
      .emailVerifiedAt;
    await verify(rawToken);

    const verified = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.EMAIL_VERIFIED },
    });
    expect(verified).toHaveLength(1);

    const afterStamp = (await testPrisma.user.findUniqueOrThrow({ where: { email: user.email } }))
      .emailVerifiedAt;
    expect(afterStamp?.getTime()).toBe(firstStamp?.getTime());
  });

  it('rejects an unknown token with the same generic message', async () => {
    const unknown = await verify('0'.repeat(64));

    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toBe(INVALID_LINK_MESSAGE);
    expect(unknown.body.error.code).toBe('EMAIL_VERIFICATION_INVALID');
  });

  it('rejects a malformed token identically to an unknown one', async () => {
    const malformed = await verify('not-even-hex');

    expect(malformed.status).toBe(400);
    expect(malformed.body.error.message).toBe(INVALID_LINK_MESSAGE);
    expect(malformed.body.error.code).toBe('EMAIL_VERIFICATION_INVALID');
  });

  it('rejects an expired token', async () => {
    const { user } = await registerUser();
    const rawToken = tokenFromLastEmail();

    await testPrisma.authToken.updateMany({
      where: { userId: (await testPrisma.user.findUniqueOrThrow({ where: { email: user.email } })).id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await verify(rawToken);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(INVALID_LINK_MESSAGE);

    const stored = await testPrisma.user.findUniqueOrThrow({ where: { email: user.email } });
    expect(stored.emailVerifiedAt).toBeNull();
  });

  it('rejects a token of another type', async () => {
    const { user } = await registerUser();
    const userId = (await testPrisma.user.findUniqueOrThrow({ where: { email: user.email } })).id;

    const { createEmailVerificationToken } = await import('../src/services/authTokenService.js');
    const other = await createEmailVerificationToken(userId, 60, AuthTokenType.PASSWORD_RESET);

    const res = await verify(other.rawToken);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(INVALID_LINK_MESSAGE);
  });

  it('audits a known-but-rejected token as EMAIL_VERIFICATION_FAILED', async () => {
    const { user } = await registerUser();
    const userId = (await testPrisma.user.findUniqueOrThrow({ where: { email: user.email } })).id;
    const rawToken = tokenFromLastEmail();

    expect((await verify(rawToken)).status).toBe(200);
    // Second attempt: the token is known but already consumed.
    expect((await verify(rawToken)).status).toBe(400);

    const failures = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.EMAIL_VERIFICATION_FAILED },
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].entityId).toBe(userId);
    expect(failures[0].actorUserId).toBeNull();
    expect(JSON.stringify(failures[0].metadata)).not.toContain(rawToken);
  });

  it('does not audit anything for an unknown token', async () => {
    await registerUser();

    await verify('a'.repeat(64));

    const failures = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.EMAIL_VERIFICATION_FAILED },
    });
    expect(failures).toHaveLength(0);
  });

  it('requires a token and refuses extra fields', async () => {
    const missing = await request(app).post('/api/auth/verify-email').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    // Strict object: nothing may ride along with the token.
    const injected = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'a'.repeat(64), userId: 'someone-else' });
    expect(injected.status).toBe(400);
    expect(injected.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/resend-verification', () => {
  it('issues a new link and invalidates the previous one', async () => {
    const { user } = await registerUser();
    const firstToken = tokenFromLastEmail();
    await ageOutstandingTokens();

    const res = await resend(user.email);
    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe(GENERIC_RESEND_MESSAGE);

    const secondToken = tokenFromLastEmail();
    expect(secondToken).not.toBe(firstToken);

    expect((await verify(firstToken)).status).toBe(400);
    expect((await verify(secondToken)).status).toBe(200);
  });

  it('records EMAIL_VERIFICATION_RESENT', async () => {
    const { user } = await registerUser();
    await ageOutstandingTokens();

    await resend(user.email);

    const resent = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.EMAIL_VERIFICATION_RESENT },
    });
    expect(resent).toHaveLength(1);
    expect(JSON.stringify(resent[0].metadata)).not.toContain(tokenFromLastEmail());
  });

  it('suppresses a resend inside the cooldown without sending mail', async () => {
    const { user } = await registerUser();
    clearCapturedEmails();

    const res = await resend(user.email);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe(GENERIC_RESEND_MESSAGE);
    expect(getCapturedEmails()).toHaveLength(0);
  });

  it('allows a resend once the cooldown has elapsed', async () => {
    const { user } = await registerUser();
    await ageOutstandingTokens();
    clearCapturedEmails();

    const res = await resend(user.email);

    expect(res.status).toBe(200);
    expect(getCapturedEmails()).toHaveLength(1);
  });

  it('answers identically for an unknown address', async () => {
    await registerUser();

    const res = await resend('nobody-here@example.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: GENERIC_RESEND_MESSAGE } });
  });

  it('answers identically for an already verified account and sends nothing', async () => {
    const { user } = await registerUser();
    await verify(tokenFromLastEmail());
    clearCapturedEmails();

    const res = await resend(user.email);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: GENERIC_RESEND_MESSAGE } });
    expect(getCapturedEmails()).toHaveLength(0);
  });

  it('never reveals which addresses exist', async () => {
    const { user } = await registerUser();
    await verify(tokenFromLastEmail());

    const known = await resend(user.email);
    const unknown = await resend('nobody-here@example.com');

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
  });

  it('validates the email field', async () => {
    const res = await resend('not-an-email');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rate limits repeated resend attempts from one client', async () => {
    const { user } = await registerUser();

    const responses = [];
    for (let attempt = 0; attempt < 25; attempt += 1) {
      responses.push(await resend(user.email));
    }

    const limited = responses.filter((res) => res.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0].body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

describe('verification does not gate access', () => {
  it('lets an unverified user log in and reports emailVerified: false', async () => {
    const { user } = await registerUser();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password });

    expect(login.status).toBe(200);
    expect(login.body.data.user.emailVerified).toBe(false);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.data.user.emailVerified).toBe(false);
  });

  it('reports emailVerified: true after a successful verification', async () => {
    const { user } = await registerUser();
    await verify(tokenFromLastEmail());

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password });

    expect(login.body.data.user.emailVerified).toBe(true);
  });
});