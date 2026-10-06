import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { ipKeyGenerator } from 'express-rate-limit';
import { AccountStatus, AuthTokenType, Role } from '@prisma/client';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, verifyPassword } from '../src/services/authService.js';
import { AuditActions } from '../src/services/auditLogService.js';
import {
  authRateLimit,
  resetPasswordRateLimit,
} from '../src/middleware/rateLimit.js';
import {
  clearCapturedEmails,
  getCapturedEmails,
  setEmailTransport,
} from '../src/services/emailService.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import authRoutes from '../src/routes/authRoutes.js';

const GENERIC_FORGOT_MESSAGE =
  'If an account exists for this email address, a password reset email has been sent.';
const INVALID_LINK_MESSAGE = 'This password reset link is invalid or has expired.';
const RESET_SUCCESS_MESSAGE = 'Your password has been reset. Please sign in with your new password.';

const CLIENT_KEY = ipKeyGenerator('127.0.0.1', 56);

const OLD_PASSWORD = 'OldPassword123!';
const NEW_PASSWORD = 'BrandNewPassword456!';

let app: express.Express;

/**
 * The auth and reset limiters are per-IP budgets of 5 per 15 minutes outside
 * development, and these tests deliberately drive far more requests per scenario
 * than any real user would. They are cleared between tests and inside the
 * helpers below so a scenario is never cut short by a limiter that is not what
 * it is testing. Rate-limit behaviour itself is asserted in rateLimit.test.ts.
 *
 * `forgotPasswordRateLimit` is keyed by (normalized email, IP) and every test
 * uses a fresh address, so it needs no reset.
 */
function clearIpLimiterBudgets(): void {
  authRateLimit.resetKey(CLIENT_KEY);
  resetPasswordRateLimit.resetKey(CLIENT_KEY);
}

beforeEach(() => {
  clearCapturedEmails();
  setEmailTransport(null);
  clearIpLimiterBudgets();

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
});

afterEach(() => {
  setEmailTransport(null);
});

interface TestAccount {
  id: string;
  email: string;
  passwordHash: string;
}

async function createAccount(
  overrides: { email?: string; status?: AccountStatus; emailVerifiedAt?: Date | null } = {}
): Promise<TestAccount> {
  return testPrisma.user.create({
    data: {
      email: overrides.email ?? createTestUser().email,
      passwordHash: await hashPassword(OLD_PASSWORD),
      firstName: 'Jane',
      lastName: 'Doe',
      role: Role.USER,
      status: overrides.status ?? AccountStatus.ACTIVE,
      emailVerifiedAt:
        'emailVerifiedAt' in overrides ? (overrides.emailVerifiedAt ?? null) : new Date(),
    },
    select: { id: true, email: true, passwordHash: true },
  });
}

/** Extracts the raw token from the link actually emailed, as a recipient would. */
function tokenFromLastEmail(): string {
  const emails = getCapturedEmails();
  expect(emails.length).toBeGreaterThan(0);

  const link = /reset-password\?token=([0-9a-f]+)/.exec(emails[emails.length - 1].html);
  expect(link, 'password reset email did not contain a link').not.toBeNull();

  return link![1];
}

/** The counterpart for the verification link, used to prove type confusion fails. */
function verificationTokenFromLastEmail(): string {
  const emails = getCapturedEmails();
  expect(emails.length).toBeGreaterThan(0);

  const link = /verify-email\?token=([0-9a-f]+)/.exec(emails[emails.length - 1].html);
  expect(link, 'verification email did not contain a link').not.toBeNull();

  return link![1];
}

/** Ages outstanding reset tokens out of the cooldown window. */
async function ageOutstandingTokens(): Promise<void> {
  await testPrisma.authToken.updateMany({
    where: { type: AuthTokenType.PASSWORD_RESET },
    data: { createdAt: new Date(Date.now() - 3_600_000) },
  });
}

function forgot(email: string) {
  return request(app).post('/api/auth/forgot-password').send({ email });
}

async function requestResetLink(account: TestAccount): Promise<string> {
  await ageOutstandingTokens();
  clearIpLimiterBudgets();
  const res = await forgot(account.email);
  expect(res.status).toBe(200);
  return tokenFromLastEmail();
}

function reset(token: string, newPassword = NEW_PASSWORD) {
  return request(app).post('/api/auth/reset-password').send({ token, newPassword });
}

async function auditRows(userId: string) {
  return testPrisma.auditLog.findMany({
    where: { entityId: userId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Asserts the one rejection every unusable token produces. The error handler
 * echoes the message at the top level too, so the comparison pins the whole
 * observable shape: status, `success`, `error.code`, `error.message` and the
 * top-level `message`.
 */
function expectGenericInvalidLink(res: request.Response): void {
  expect(res.status).toBe(400);
  expect(res.body).toEqual({
    success: false,
    message: INVALID_LINK_MESSAGE,
    error: { code: 'PASSWORD_RESET_INVALID', message: INVALID_LINK_MESSAGE },
  });
}

describe('POST /api/auth/forgot-password', () => {
  it('issues a PASSWORD_RESET token and emails a single-use link', async () => {
    const account = await createAccount();

    const res = await forgot(account.email);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: GENERIC_FORGOT_MESSAGE } });

    const tokens = await testPrisma.authToken.findMany({
      where: { userId: account.id, type: AuthTokenType.PASSWORD_RESET },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].usedAt).toBeNull();

    const emails = getCapturedEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe(account.email);
    expect(emails[0].subject).toMatch(/reset your .*password/i);
    expect(emails[0].html).toContain(`/reset-password?token=${tokenFromLastEmail()}`);
  });

  it('stores only a SHA-256 hash of the token, never the raw value', async () => {
    const account = await createAccount();

    const rawToken = await requestResetLink(account);

    const stored = await testPrisma.authToken.findFirstOrThrow({
      where: { userId: account.id, type: AuthTokenType.PASSWORD_RESET },
    });

    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toBe(rawToken);

    // No row, audit entry or captured email may contain the raw token as a
    // standalone value; the only place it appears is inside the emailed link.
    const emails = getCapturedEmails();
    expect(emails[0].subject).not.toContain(rawToken);
    expect(emails[0].text.split(rawToken)).toHaveLength(2);
  });

  it('never leaks the raw token or new password into audit metadata', async () => {
    const account = await createAccount();

    const rawToken = await requestResetLink(account);
    await reset(rawToken);

    const rows = await auditRows(account.id);
    expect(rows.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain(OLD_PASSWORD);

    // The admin audit read API drops keys matching `…token…`; the write must not
    // lean on that to stay clean.
    for (const row of rows) {
      expect(JSON.stringify(row.metadata)).not.toMatch(/tokenHash|resetToken|rawToken/i);
    }
  });

  it('answers identically for an unknown address', async () => {
    const res = await forgot('nobody-here@example.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: GENERIC_FORGOT_MESSAGE } });
    expect(getCapturedEmails()).toHaveLength(0);
  });

  it('answers identically for a suspended account and sends nothing', async () => {
    const account = await createAccount({ status: AccountStatus.SUSPENDED });

    const res = await forgot(account.email);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: GENERIC_FORGOT_MESSAGE } });
    expect(getCapturedEmails()).toHaveLength(0);

    const tokens = await testPrisma.authToken.findMany({
      where: { userId: account.id, type: AuthTokenType.PASSWORD_RESET },
    });
    expect(tokens).toHaveLength(0);
  });

  it('answers identically for a deactivated account and sends nothing', async () => {
    const account = await createAccount({ status: AccountStatus.DEACTIVATED });

    const res = await forgot(account.email);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: GENERIC_FORGOT_MESSAGE } });
    expect(getCapturedEmails()).toHaveLength(0);
  });

  it('answers identically for an unverified account but still issues a link', async () => {
    const account = await createAccount({ emailVerifiedAt: null });

    const res = await forgot(account.email);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: GENERIC_FORGOT_MESSAGE } });
    // A reset link is issued regardless of verification state: a user who never
    // confirmed the address must still be able to recover the account.
    expect(getCapturedEmails()).toHaveLength(1);
  });

  it('suppresses a second request inside the cooldown with the same response', async () => {
    const account = await createAccount();

    const first = await forgot(account.email);
    const second = await forgot(account.email);

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(getCapturedEmails()).toHaveLength(1);
  });

  it('supersedes outstanding links so only the newest one works', async () => {
    const account = await createAccount();

    const staleToken = await requestResetLink(account);
    await ageOutstandingTokens();

    const freshRes = await forgot(account.email);
    expect(freshRes.status).toBe(200);
    const freshToken = tokenFromLastEmail();

    const stale = await reset(staleToken);
    expect(stale.status).toBe(400);
    expect(stale.body.error.code).toBe('PASSWORD_RESET_INVALID');

    const fresh = await reset(freshToken);
    expect(fresh.status).toBe(200);
  });

  it('normalizes the address so casing variants share one bucket', async () => {
    const account = await createAccount();

    const res = await forgot(account.email.toUpperCase());

    expect(res.status).toBe(200);
    expect(getCapturedEmails()[0].to).toBe(account.email);
  });

  it('rejects an invalid address at the schema boundary', async () => {
    const res = await forgot('not-an-email');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown body fields instead of ignoring them', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: createTestUser().email, userId: 'attacker-supplied' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports a transport outage as the same generic success', async () => {
    const account = await createAccount();
    setEmailTransport({
      name: 'stub-failure',
      send: async () => {
        throw new Error('provider exploded');
      },
    });

    const res = await forgot(account.email);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: GENERIC_FORGOT_MESSAGE } });
  });
});

describe('POST /api/auth/reset-password', () => {
  it('changes the password so the new one signs in and the old one does not', async () => {
    const account = await createAccount();
    const rawToken = await requestResetLink(account);

    const res = await reset(rawToken);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { message: RESET_SUCCESS_MESSAGE } });

    const loginWithOld = await request(app)
      .post('/api/auth/login')
      .send({ email: account.email, password: OLD_PASSWORD });
    expect(loginWithOld.status).toBe(401);
    expect(loginWithOld.body.error.code).toBe('INVALID_CREDENTIALS');

    const loginWithNew = await request(app)
      .post('/api/auth/login')
      .send({ email: account.email, password: NEW_PASSWORD });
    expect(loginWithNew.status).toBe(200);
    expect(loginWithNew.body.data.user.email).toBe(account.email);
  });

  it('stores an Argon2id hash, never the password itself', async () => {
    const account = await createAccount();
    const rawToken = await requestResetLink(account);

    await reset(rawToken);

    const stored = await testPrisma.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toBe(NEW_PASSWORD);
    await expect(verifyPassword(stored.passwordHash, NEW_PASSWORD)).resolves.toBe(true);
  });

  it('consumes the token so it cannot be replayed', async () => {
    const account = await createAccount();
    const rawToken = await requestResetLink(account);

    expect((await reset(rawToken)).status).toBe(200);

    const replay = await reset(rawToken);
    expectGenericInvalidLink(replay);

    // The replay must not have rolled the password back.
    const stored = await testPrisma.user.findUniqueOrThrow({ where: { id: account.id } });
    await expect(verifyPassword(stored.passwordHash, NEW_PASSWORD)).resolves.toBe(true);
  });

  it('revokes every session of the affected account', async () => {
    const account = await createAccount();

    const first = await request(app)
      .post('/api/auth/login')
      .send({ email: account.email, password: OLD_PASSWORD });
    const second = await request(app)
      .post('/api/auth/login')
      .send({ email: account.email, password: OLD_PASSWORD });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const cookies = [first, second].map((res) => {
      const cookie = res.headers['set-cookie'];
      const value = Array.isArray(cookie) ? cookie[0] : cookie;
      return (value ?? '').split(';')[0];
    });

    const rawToken = await requestResetLink(account);
    expect((await reset(rawToken)).status).toBe(200);

    clearIpLimiterBudgets();
    for (const cookie of cookies) {
      const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
      expect(refreshed.status).toBe(401);
      expect(refreshed.body.error.code).toBe('TOKEN_REVOKED');
    }
  });

  it('leaves other accounts completely untouched', async () => {
    const victim = await createAccount();
    const bystander = await createAccount();

    const bystanderLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: bystander.email, password: OLD_PASSWORD });
    expect(bystanderLogin.status).toBe(200);
    const cookie = (bystanderLogin.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

    const rawToken = await requestResetLink(victim);
    expect((await reset(rawToken)).status).toBe(200);

    // The bystander's session still refreshes and their hash is unchanged.
    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);

    const storedBystander = await testPrisma.user.findUniqueOrThrow({
      where: { id: bystander.id },
    });
    expect(storedBystander.passwordHash).toBe(bystander.passwordHash);
  });

  it('invalidates every other outstanding reset link for the account', async () => {
    const account = await createAccount();

    const firstToken = await requestResetLink(account);
    await ageOutstandingTokens();
    await forgot(account.email);
    const secondToken = tokenFromLastEmail();

    clearIpLimiterBudgets();
    expect((await reset(secondToken)).status).toBe(200);
    expect((await reset(firstToken)).status).toBe(400);

    // And a link minted afterwards is a fresh, single-use one.
    clearIpLimiterBudgets();
    await ageOutstandingTokens();
    await forgot(account.email);
    const thirdToken = tokenFromLastEmail();
    clearIpLimiterBudgets();
    expect((await reset(thirdToken)).status).toBe(200);
    expect((await reset(thirdToken)).status).toBe(400);
  });

  it('rejects an unknown token with the generic invalid-link response', async () => {
    const res = await reset('a'.repeat(64));

    expectGenericInvalidLink(res);
  });

  it('rejects an expired token with the identical response', async () => {
    const account = await createAccount();
    const rawToken = await requestResetLink(account);

    await testPrisma.authToken.updateMany({
      where: { userId: account.id, type: AuthTokenType.PASSWORD_RESET },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await reset(rawToken);

    expectGenericInvalidLink(res);

    const stored = await testPrisma.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.passwordHash).toBe(account.passwordHash);
  });

  it('refuses a token minted for another purpose', async () => {
    const registration = await request(app)
      .post('/api/auth/register')
      .send(createTestUser());
    expect(registration.status).toBe(201);
    const email = registration.body.data.user.email as string;

    const verificationToken = verificationTokenFromLastEmail();

    const res = await reset(verificationToken);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PASSWORD_RESET_INVALID');

    // The verification token must be untouched by the failed attempt.
    const stored = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.emailVerifiedAt).toBeNull();
    const token = await testPrisma.authToken.findFirstOrThrow({
      where: { userId: stored.id, type: AuthTokenType.EMAIL_VERIFICATION },
    });
    expect(token.usedAt).toBeNull();
  });

  it('applies the reset to the token owner and to nobody else', async () => {
    const owner = await createAccount();
    const bystander = await createAccount();

    const ownerToken = await requestResetLink(owner);
    const res = await reset(ownerToken);

    expect(res.status).toBe(200);

    const storedOwner = await testPrisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    await expect(verifyPassword(storedOwner.passwordHash, NEW_PASSWORD)).resolves.toBe(true);

    const storedBystander = await testPrisma.user.findUniqueOrThrow({
      where: { id: bystander.id },
    });
    expect(storedBystander.passwordHash).toBe(bystander.passwordHash);
  });

  it('refuses a valid token belonging to a suspended account', async () => {
    const account = await createAccount();
    const rawToken = await requestResetLink(account);

    await testPrisma.user.update({
      where: { id: account.id },
      data: { status: AccountStatus.SUSPENDED },
    });

    const res = await reset(rawToken);

    expectGenericInvalidLink(res);

    const stored = await testPrisma.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.passwordHash).toBe(account.passwordHash);

    // The link is spent, so it cannot be banked for a future reinstatement.
    expectGenericInvalidLink(await reset(rawToken));
  });

  it('enforces the shared 8–128 character password policy', async () => {
    const account = await createAccount();
    const rawToken = await requestResetLink(account);

    const tooShort = await reset(rawToken, 'Sh0rt!');
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error.code).toBe('VALIDATION_ERROR');

    const tooLong = await reset(rawToken, 'a'.repeat(129));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');

    // A rejected password must not have consumed the token.
    expect((await reset(rawToken)).status).toBe(200);
  });

  it('rejects unknown body fields', async () => {
    const account = await createAccount();
    const rawToken = await requestResetLink(account);

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: NEW_PASSWORD, skipTokenCheck: true });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not consume the token on an unknown body shape', async () => {
    const account = await createAccount();
    const rawToken = await requestResetLink(account);

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken });
    expect(res.status).toBe(400);

    expect((await reset(rawToken)).status).toBe(200);
  });

  it('writes no audit row for a guessed token', async () => {
    await reset('b'.repeat(64));

    const rows = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.PASSWORD_RESET_FAILED },
    });
    expect(rows).toHaveLength(0);
  });

  it('does not leak whether a guessed token is genuine', async () => {
    const account = await createAccount();
    const rawToken = await requestResetLink(account);

    const unknown = await reset('c'.repeat(64));
    const used = await reset(rawToken);

    expect(used.status).toBe(200);

    clearIpLimiterBudgets();
    const replay = await reset(rawToken);

    // Unknown, spent and replayed all produce exactly one rejection shape.
    expectGenericInvalidLink(unknown);
    expectGenericInvalidLink(replay);
    expect(replay.body).toEqual(unknown.body);
    expect(account.id).toBeDefined();
  });
});

describe('password-reset audit trail', () => {
  it('records the request and the completion with no credential material', async () => {
    const account = await createAccount();

    const rawToken = await requestResetLink(account);
    await reset(rawToken);

    const rows = await auditRows(account.id);
    const actions = rows.map((row) => row.action);

    expect(actions).toContain(AuditActions.PASSWORD_RESET_REQUESTED);
    expect(actions).toContain(AuditActions.PASSWORD_RESET_COMPLETED);

    const completed = rows.find((row) => row.action === AuditActions.PASSWORD_RESET_COMPLETED);
    expect(completed?.actorUserId).toBe(account.id);
    expect(completed?.entityType).toBe('User');
    // No sessions existed and the only link was the one just consumed, so both
    // counters are legitimately zero — the row records that the work ran.
    expect(completed?.metadata).toMatchObject({
      targetUserId: account.id,
      revokedSessions: 0,
      invalidatedLinks: 0,
    });
  });

  it('records nothing when the address does not exist', async () => {
    await forgot('ghost@example.com');

    const rows = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.PASSWORD_RESET_REQUESTED },
    });
    expect(rows).toHaveLength(0);
  });

  it('records nothing when a suspended account is refused', async () => {
    const account = await createAccount({ status: AccountStatus.SUSPENDED });

    await forgot(account.email);

    const rows = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.PASSWORD_RESET_REQUESTED },
    });
    expect(rows).toHaveLength(0);
  });

  it('records a failure when a real token hits an ineligible account', async () => {
    const account = await createAccount();
    const rawToken = await requestResetLink(account);
    await testPrisma.user.update({
      where: { id: account.id },
      data: { status: AccountStatus.DEACTIVATED },
    });

    await reset(rawToken);

    const rows = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.PASSWORD_RESET_FAILED, entityId: account.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ reason: 'account_ineligible' });
  });
});