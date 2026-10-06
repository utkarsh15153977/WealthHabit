import { describe, it, expect } from 'vitest';
import { AccountStatus, AuthTokenType, Role } from '@prisma/client';
import { Authenticator } from '@otplib/core';
import { createDigest, createRandomBytes } from '@otplib/plugin-crypto';
import { keyDecoder, keyEncoder } from '@otplib/plugin-thirty-two';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword } from '../src/services/authService.js';
import { encryptTOTPSecret } from '../src/crypto/aesGcm.js';
import {
  mfaService,
  mfaMessages,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from '../src/services/mfaService.js';
import { hashAuthToken } from '../src/services/authTokenService.js';
import { AuditActions } from '../src/services/auditLogService.js';
import { AuthErrorCodes } from '../src/types/auth.js';
import { AppError } from '../src/utils/errors.js';

const PASSWORD = 'CurrentPassword123!';

function testAuthenticator(epochMs: number) {
  return new Authenticator({
    createDigest,
    createRandomBytes,
    keyDecoder,
    keyEncoder,
    step: 30,
    epoch: epochMs,
    window: 0,
  });
}

/** A TOTP code that the service (window = 1 step either side) accepts right now. */
function currentCode(secret: string): string {
  return testAuthenticator(Date.now()).generate(secret);
}

/** A code from a step far enough (90s) that window 1 will never accept it. */
function staleCode(secret: string): string {
  return testAuthenticator(Date.now() + 90_000).generate(secret);
}

async function createUser() {
  return testPrisma.user.create({
    data: {
      email: createTestUser().email,
      passwordHash: await hashPassword(PASSWORD),
      firstName: 'Jane',
      lastName: 'Doe',
      role: Role.USER,
      status: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
}

async function createLiveSession(userId: string, label: string) {
  return testPrisma.session.create({
    data: {
      userId,
      refreshTokenHash: `mfa-hash-${label}-${Math.random().toString(36)}`,
      tokenFamilyId: `mfa-family-${label}-${Math.random().toString(36)}`,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

async function mfaChallengeTokens(userId: string) {
  return testPrisma.authToken.findMany({
    where: { userId, type: AuthTokenType.MFA_CHALLENGE },
  });
}

async function apiErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as AppError).code;
  }
  return undefined;
}

async function enableMfaAndVerify(userId: string, secret: string, keepSessionId: string | null) {
  return mfaService.enableMfa({ userId, code: currentCode(secret), keepSessionId });
}

function expectRecoveryShape(codes: string[]): void {
  expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
  for (const code of codes) {
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  }
}

describe('startMfaSetup', () => {
  it('issues a 32-character base32 secret, a scannable URI and a pending row', async () => {
    const user = await createUser();

    const result = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });

    expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\/WealthHabit:.+\?secret=/);
    expect(result.otpauthUri).toContain(`secret=${result.secret}`);
    expect(result.otpauthUri).toContain('issuer=WealthHabit');
    expect(result.otpauthUri).toContain(encodeURIComponent(user.email));

    const row = await testPrisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.enabledAt).toBeNull();
    expect(row.setupStartedAt).not.toBeNull();

    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: AuditActions.MFA_SETUP_STARTED },
    });
    expect(audit.metadata).toMatchObject({ targetUserId: user.id });
    expect(JSON.stringify(audit.metadata)).not.toContain(result.secret);
  });

  it('rejects a wrong re-authentication password with PASSWORD_UNVERIFIED', async () => {
    const user = await createUser();

    const code = await apiErrorCode(
      mfaService.startMfaSetup({ userId: user.id, currentPassword: 'NotThePassword987!' })
    );

    expect(code).toBe(AuthErrorCodes.PASSWORD_UNVERIFIED);
    expect(await testPrisma.userMfa.findUnique({ where: { userId: user.id } })).toBeNull();
  });

  it('refreshes a pending enrollment without touching a completed one', async () => {
    const user = await createUser();

    const first = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });

    // Restart a pending enrollment: new secret, still pending.
    const second = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });
    expect(second.secret).not.toBe(first.secret);
    const pending = await testPrisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } });
    expect(pending.enabledAt).toBeNull();

    // A completed enrollment is immutable to restart-enrollment: a stale setup
    // silently downgrading an enabled account would be a security bug.
    await enableMfaAndVerify(user.id, second.secret, null);
    await expect(
      mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD })
    ).rejects.toMatchObject({ code: AuthErrorCodes.MFA_ALREADY_ENABLED });

    const row = await testPrisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.enabledAt).not.toBeNull();
  });

  it('records audit metadata whose only timing is the expiry itself', async () => {
    const user = await createUser();

    const result = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });

    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: AuditActions.MFA_SETUP_STARTED },
    });
    expect(audit.metadata).toMatchObject({
      targetUserId: user.id,
      expiresAt: result.expiresAt.toISOString(),
    });
  });
});

describe('enableMfa', () => {
  it('requires that an enrollment was started', async () => {
    const user = await createUser();

    const code = await apiErrorCode(
      mfaService.enableMfa({ userId: user.id, code: '123456', keepSessionId: null })
    );

    expect(code).toBe(AuthErrorCodes.MFA_SETUP_REQUIRED);
  });

  it('rejects an expired enrollment', async () => {
    const user = await createUser();
    await testPrisma.userMfa.create({
      data: {
        userId: user.id,
        secretEncrypted: encryptTOTPSecret('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
        setupStartedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const code = await apiErrorCode(
      mfaService.enableMfa({ userId: user.id, code: currentCode('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), keepSessionId: null })
    );

    expect(code).toBe(AuthErrorCodes.MFA_SETUP_EXPIRED);
  });

  it('rejects a wrong confirming code', async () => {
    const user = await createUser();
    const { secret } = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });

    const code = await apiErrorCode(
      mfaService.enableMfa({ userId: user.id, code: '000000', keepSessionId: null })
    );

    expect(code).toBe(AuthErrorCodes.MFA_CODE_INVALID);
    expect((await testPrisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } })).enabledAt).toBeNull();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('enables 2FA, returns ten recovery codes, stores only their hashes and revokes other sessions', async () => {
    const user = await createUser();
    const keep = await createLiveSession(user.id, 'keep');
    const stale = await createLiveSession(user.id, 'revoked');
    await createLiveSession(user.id, 'revoked2');

    const { secret } = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });

    const result = await mfaService.enableMfa({
      userId: user.id,
      code: currentCode(secret),
      keepSessionId: keep.id,
    });

    expectRecoveryShape(result.recoveryCodes);
    expect(result.revokedSessions).toBe(2);

    const row = await testPrisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.enabledAt).not.toBeNull();

    const storedCodes = await testPrisma.recoveryCode.findMany({ where: { userId: user.id } });
    expect(storedCodes).toHaveLength(10);
    for (const code of result.recoveryCodes) {
      const stored = storedCodes.find((candidate) => candidate.codeHash === hashRecoveryCode(code));
      expect(stored).toBeDefined();
      expect(stored?.usedAt).toBeNull();
    }
    // Plaintext never lands at rest.
    for (const code of result.recoveryCodes) {
      expect(storedCodes.some((candidate) => candidate.codeHash === code)).toBe(false);
    }

    const sessions = await testPrisma.session.findMany({ where: { userId: user.id } });
    expect(sessions.find((s) => s.id === keep.id)?.revokedAt).toBeNull();
    for (const id of [stale.id]) {
      expect(sessions.find((s) => s.id === id)?.revokedAt).not.toBeNull();
    }

    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: AuditActions.MFA_ENABLED },
    });
    expect(audit.metadata).toMatchObject({ targetUserId: user.id, recoveryCodeCount: 10, revokedSessions: 2 });

    const state = await mfaService.getTwoFactorState(user.id);
    expect(state).toEqual({ enabled: true, pending: false });
  });

  it('accepts a code from the adjacent 30s step (window = 1)', async () => {
    const user = await createUser();
    const { secret } = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });

    const adjacent = testAuthenticator(Date.now() - 30_000).generate(secret);

    await expect(mfaService.enableMfa({ userId: user.id, code: adjacent, keepSessionId: null })).resolves.toMatchObject({
      recoveryCodes: expect.any(Array),
    });
  });
});

describe('createLoginChallenge', () => {
  it('mints a short-lived single-use challenge and supersedes the previous one', async () => {
    const user = await createUser();
    const { secret } = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });
    await enableMfaAndVerify(user.id, secret, null);

    const first = await mfaService.createLoginChallenge(user.id);
    const second = await mfaService.createLoginChallenge(user.id);

    expect(first.challengeToken).not.toBe(second.challengeToken);
    expect(first.expiresInSeconds).toBe(600);

    const tokens = await mfaChallengeTokens(user.id);
    const firstRow = tokens.find((t) => t.tokenHash === hashAuthToken(first.challengeToken));
    const secondRow = tokens.find((t) => t.tokenHash === hashAuthToken(second.challengeToken));

    expect(firstRow?.usedAt).not.toBeNull();
    expect(secondRow?.usedAt).toBeNull();

    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: AuditActions.MFA_LOGIN_CHALLENGE_CREATED },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({ targetUserId: user.id, invalidatedChallenges: 1 });
  });
});

describe('verifyMfaLoginChallenge', () => {
  async function enabledUser() {
    const user = await createUser();
    const { secret } = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });
    await enableMfaAndVerify(user.id, secret, null);
    return { user, secret };
  }

  it('signs in with a valid code: session, lastLoginAt, single-use challenge, audit', async () => {
    const { user, secret } = await enabledUser();
    const { challengeToken } = await mfaService.createLoginChallenge(user.id);

    const outcome = await mfaService.verifyMfaLoginChallenge(challengeToken, currentCode(secret));

    expect(outcome.signedIn).toBe(true);
    if (!outcome.signedIn) return;
    expect(outcome.user).toMatchObject({ id: user.id, twoFactorEnabled: true });
    expect(outcome.accessToken).toBeTruthy();
    expect(outcome.refreshToken).toBeTruthy();

    const tokens = await mfaChallengeTokens(user.id);
    expect(tokens.filter((t) => t.usedAt === null)).toHaveLength(0);
    expect(tokens.find((t) => t.tokenHash === hashAuthToken(challengeToken))?.usedAt).not.toBeNull();

    const sessions = await testPrisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);

    const updated = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.lastLoginAt).not.toBeNull();

    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: AuditActions.MFA_LOGIN_SUCCESS },
    });
    expect(audit.metadata).toMatchObject({ targetUserId: user.id });
  });

  it('rejects a wrong code with a generic refusal and one failure audit, creating no session', async () => {
    const { user, secret } = await enabledUser();
    const { challengeToken } = await mfaService.createLoginChallenge(user.id);

    const outcome = await mfaService.verifyMfaLoginChallenge(challengeToken, staleCode(secret));

    expect(outcome).toEqual({ signedIn: false, reason: 'invalid_code' });
    expect((await testPrisma.session.findMany({ where: { userId: user.id } }))).toHaveLength(0);
    expect((await mfaChallengeTokens(user.id)).every((t) => t.usedAt === null)).toBe(true);

    const failed = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: AuditActions.MFA_LOGIN_FAILED },
    });
    expect(failed.metadata).toMatchObject({ targetUserId: user.id, reason: 'invalid_code' });
  });

  it('cannot be replayed after success', async () => {
    const { user, secret } = await enabledUser();
    const { challengeToken } = await mfaService.createLoginChallenge(user.id);

    const first = await mfaService.verifyMfaLoginChallenge(challengeToken, currentCode(secret));
    expect(first.signedIn).toBe(true);

    const second = await mfaService.verifyMfaLoginChallenge(challengeToken, currentCode(secret));
    expect(second.signedIn).toBe(false);

    expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('answers an unknown token generically and writes no audit row', async () => {
    await enabledUser();

    const outcome = await mfaService.verifyMfaLoginChallenge('a'.repeat(64), '123456');

    expect(outcome).toEqual({ signedIn: false, reason: 'unknown_token' });
    expect(await testPrisma.auditLog.count({ where: { action: AuditActions.MFA_LOGIN_FAILED } })).toBe(0);
  });

  it('renders a challenge minted before a disable inert: consumed, no session, no failure audit', async () => {
    const { user, secret } = await enabledUser();
    const { challengeToken } = await mfaService.createLoginChallenge(user.id);

    await mfaService.disableMfa({ userId: user.id, password: PASSWORD, code: currentCode(secret), keepSessionId: null });

    const outcome = await mfaService.verifyMfaLoginChallenge(challengeToken, currentCode(secret));

    // Disabling revokes every outstanding challenge, so this attempt is
    // classified as an already-used token rather than a fresh failure.
    expect(outcome.signedIn).toBe(false);
    expect(await testPrisma.auditLog.count({ where: { action: AuditActions.MFA_LOGIN_FAILED } })).toBe(0);
    expect((await mfaChallengeTokens(user.id)).every((t) => t.usedAt !== null)).toBe(true);
    expect(await testPrisma.session.count()).toBe(0);
  });
});

describe('verifyMfaLoginRecoveryCode', () => {
  async function enabledUser() {
    const user = await createUser();
    const { secret } = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });
    const enabled = await enableMfaAndVerify(user.id, secret, null);
    return { user, secret, recoveryCodes: enabled.recoveryCodes };
  }

  it('signs in with a recovery code, spends it, and audits', async () => {
    const { user, recoveryCodes } = await enabledUser();
    const { challengeToken } = await mfaService.createLoginChallenge(user.id);

    const outcome = await mfaService.verifyMfaLoginRecoveryCode(challengeToken, recoveryCodes[0]);

    expect(outcome.signedIn).toBe(true);
    if (!outcome.signedIn) return;

    const stored = await testPrisma.recoveryCode.findMany({
      where: { userId: user.id, codeHash: hashRecoveryCode(recoveryCodes[0]) },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].usedAt).not.toBeNull();

    expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect((await mfaChallengeTokens(user.id)).every((t) => t.usedAt !== null)).toBe(true);

    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: AuditActions.MFA_RECOVERY_CODE_USED },
    });
    expect(audit.metadata).toMatchObject({ targetUserId: user.id });
  });

  it('normalizes sloppy input (lowercase, stripped dashes)', async () => {
    const { user, recoveryCodes } = await enabledUser();
    const { challengeToken } = await mfaService.createLoginChallenge(user.id);

    const sloppy = normalizeRecoveryCode(recoveryCodes[1]).toLowerCase().replace(/-/g, '');

    const outcome = await mfaService.verifyMfaLoginRecoveryCode(challengeToken, sloppy);
    expect(outcome.signedIn).toBe(true);
  });

  it('does not spend the challenge on a wrong code, so the account can still sign in with a TOTP code', async () => {
    const { user, secret, recoveryCodes } = await enabledUser();
    const { challengeToken } = await mfaService.createLoginChallenge(user.id);

    const wrong = await mfaService.verifyMfaLoginRecoveryCode(challengeToken, 'ZZZZ-ZZZZ-ZZZZ');
    expect(wrong.signedIn).toBe(false);

    // The challenge survived the rollback: the genuine code still works.
    const correct = await mfaService.verifyMfaLoginChallenge(challengeToken, currentCode(secret));
    expect(correct.signedIn).toBe(true);
    expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(recoveryCodes.length).toBe(10);
  });

  it('refuses a spent recovery code, and the challenge remains good for another code', async () => {
    const { user, secret, recoveryCodes } = await enabledUser();
    const firstChallenge = await mfaService.createLoginChallenge(user.id);
    await mfaService.verifyMfaLoginRecoveryCode(firstChallenge.challengeToken, recoveryCodes[0]);

    const secondChallenge = await mfaService.createLoginChallenge(user.id);
    const replay = await mfaService.verifyMfaLoginRecoveryCode(secondChallenge.challengeToken, recoveryCodes[0]);
    expect(replay.signedIn).toBe(false);

    const stillWorks = await mfaService.verifyMfaLoginChallenge(secondChallenge.challengeToken, currentCode(secret));
    expect(stillWorks.signedIn).toBe(true);
  });
});

describe('disableMfa', () => {
  async function enabledUser() {
    const user = await createUser();
    const { secret } = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });
    await enableMfaAndVerify(user.id, secret, null);
    return { user, secret };
  }

  it('refuses when 2FA is not enabled', async () => {
    const user = await createUser();

    const code = await apiErrorCode(
      mfaService.disableMfa({ userId: user.id, password: PASSWORD, code: '123456', keepSessionId: null })
    );

    expect(code).toBe(AuthErrorCodes.MFA_NOT_ENABLED);
  });

  it('requires the password and a live code, then removes every artifact', async () => {
    const { user, secret } = await enabledUser();
    const keep = await createLiveSession(user.id, 'keep');
    const other = await createLiveSession(user.id, 'other');

    const badPassword = await apiErrorCode(
      mfaService.disableMfa({ userId: user.id, password: 'Wrong!Password', code: currentCode(secret), keepSessionId: null })
    );
    expect(badPassword).toBe(AuthErrorCodes.PASSWORD_UNVERIFIED);

    const { challengeToken } = await mfaService.createLoginChallenge(user.id);
    const badCode = await apiErrorCode(
      mfaService.disableMfa({ userId: user.id, password: PASSWORD, code: staleCode(secret), keepSessionId: null })
    );
    expect(badCode).toBe(AuthErrorCodes.MFA_CODE_INVALID);

    const result = await mfaService.disableMfa({
      userId: user.id,
      password: PASSWORD,
      code: currentCode(secret),
      keepSessionId: keep.id,
    });
    expect(result.revokedSessions).toBe(1);

    await expect(testPrisma.userMfa.findUnique({ where: { userId: user.id } })).resolves.toBeNull();
    expect(await testPrisma.recoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect((await testPrisma.session.findUniqueOrThrow({ where: { id: keep.id } })).revokedAt).toBeNull();
    expect((await testPrisma.session.findUniqueOrThrow({ where: { id: other.id } })).revokedAt).not.toBeNull();
    // The challenge issued while enabled was invalidated on disable.
    expect(
      (await mfaChallengeTokens(user.id)).find((t) => t.tokenHash === hashAuthToken(challengeToken))?.usedAt
    ).not.toBeNull();

    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: AuditActions.MFA_DISABLED },
    });
    expect(audit.metadata).toMatchObject({ targetUserId: user.id, revokedSessions: 1 });
  });
});

describe('regenerateRecoveryCodes', () => {
  async function enabledUser() {
    const user = await createUser();
    const { secret } = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });
    const enabled = await enableMfaAndVerify(user.id, secret, null);
    return { user, secret, firstCodes: enabled.recoveryCodes };
  }

  it('issues ten fresh codes and retires the unused previous ones while preserving history', async () => {
    const { user, secret, firstCodes } = await enabledUser();

    // Spend one code so history must survive regeneration.
    const firstChallenge = await mfaService.createLoginChallenge(user.id);
    await mfaService.verifyMfaLoginRecoveryCode(firstChallenge.challengeToken, firstCodes[0]);

    const result = await mfaService.regenerateRecoveryCodes({ userId: user.id, password: PASSWORD, code: currentCode(secret) });

    expectRecoveryShape(result.recoveryCodes);
    expect(result.recoveryCodes.every((code) => !firstCodes.includes(code))).toBe(true);

    const rows = await testPrisma.recoveryCode.findMany({ where: { userId: user.id } });
    // The old page (10 rows) was retired rather than deleted — unused codes die
    // by `usedAt`, used codes keep their history — and the new page was added.
    expect(rows).toHaveLength(20);
    expect(rows.filter((r) => r.usedAt === null)).toHaveLength(10);
    expect(rows.filter((r) => r.usedAt !== null)).toHaveLength(10);

    // Every live row is exactly one of the freshly returned codes.
    for (const code of result.recoveryCodes) {
      expect(rows.some((r) => r.codeHash === hashRecoveryCode(code) && r.usedAt === null)).toBe(true);
    }

    // The spent code keeps its usedAt timestamp; the nine unspent ones were
    // superseded (usedAt set) so they die with the old page.
    const spent = rows.find((r) => r.codeHash === hashRecoveryCode(firstCodes[0]));
    expect(spent?.usedAt).not.toBeNull();

    const otherOld = firstCodes.slice(1).map((c) => rows.find((r) => r.codeHash === hashRecoveryCode(c)));
    for (const old of otherOld) {
      expect(old?.usedAt).not.toBeNull();
    }

    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: AuditActions.MFA_RECOVERY_CODES_REGENERATED },
    });
    expect(audit.metadata).toMatchObject({ targetUserId: user.id, supersededCodes: 9 });
  });

  it('refuses when 2FA is not enabled', async () => {
    const user = await createUser();

    const code = await apiErrorCode(
      mfaService.regenerateRecoveryCodes({ userId: user.id, password: PASSWORD, code: '123456' })
    );

    expect(code).toBe(AuthErrorCodes.MFA_NOT_ENABLED);
  });
});

describe('secret hygiene in the audit trail', () => {
  it('never records secrets, tokens or plaintext codes', async () => {
    const user = await createUser();
    const result = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });
    const enabled = await enableMfaAndVerify(user.id, result.secret, null);
    const { challengeToken } = await mfaService.createLoginChallenge(user.id);
    await mfaService.verifyMfaLoginChallenge(challengeToken, currentCode(result.secret));
    const recoveryChallenge = await mfaService.createLoginChallenge(user.id);
    await mfaService.verifyMfaLoginRecoveryCode(recoveryChallenge.challengeToken, enabled.recoveryCodes[0]);

    const logs = await testPrisma.auditLog.findMany();
    const serialized = JSON.stringify(logs);

    expect(serialized).not.toContain(result.secret);
    expect(serialized).not.toContain(result.otpauthUri);
    expect(serialized).not.toContain(challengeToken);
    expect(serialized).not.toContain(hashAuthToken(challengeToken));
    expect(serialized).not.toContain(enabled.recoveryCodes[0]);
    expect(serialized).not.toContain(hashRecoveryCode(enabled.recoveryCodes[0]));
  });

  it('renders the generic rejection message and code for every unusable attempt', async () => {
    const error = mfaService.invalidMfaChallenge();
    expect(error.message).toBe(mfaMessages.invalidChallenge);
    expect(error.code).toBe(AuthErrorCodes.MFA_CHALLENGE_INVALID);
  });
});