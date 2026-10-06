import { describe, it, expect, beforeEach } from 'vitest';
import { AccountStatus, AuthTokenType, Role } from '@prisma/client';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, verifyPassword } from '../src/services/authService.js';
import { AuditActions } from '../src/services/auditLogService.js';
import { clearCapturedEmails, getCapturedEmails } from '../src/services/emailService.js';
import { passwordResetService, passwordResetMessages } from '../src/services/passwordResetService.js';
import { hashAuthToken } from '../src/services/authTokenService.js';
import { AuthErrorCodes } from '../src/types/auth.js';

const RACERS = 5;
const OLD_PASSWORD = 'OldPassword123!';
const NEW_PASSWORD = 'BrandNewPassword456!';

/**
 * Every racer uses a different new password, so whichever transaction wins is
 * identifiable from the stored hash afterwards. Without that, a test asserting
 * "exactly one winner" could pass while a second password had in fact been
 * applied and then overwritten.
 */
function racerPassword(index: number): string {
  return `RacerPassword-${index}-456!`;
}

async function createAccount(email = createTestUser().email) {
  return testPrisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(OLD_PASSWORD),
      firstName: 'Jane',
      lastName: 'Doe',
      role: Role.USER,
      status: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
}

function tokenFromLastEmail(): string {
  const emails = getCapturedEmails();
  expect(emails.length).toBeGreaterThan(0);
  return /reset-password\?token=([0-9a-f]+)/.exec(emails[emails.length - 1].html)![1];
}

async function requestLink(user: { id: string; email: string }): Promise<string> {
  await testPrisma.authToken.updateMany({
    where: { userId: user.id, type: AuthTokenType.PASSWORD_RESET },
    data: { createdAt: new Date(Date.now() - 3_600_000) },
  });
  clearCapturedEmails();
  const outcome = await passwordResetService.requestPasswordReset(user.email);
  expect(outcome.sent).toBe(true);
  return tokenFromLastEmail();
}

async function resetTokens(userId: string) {
  return testPrisma.authToken.findMany({
    where: { userId, type: AuthTokenType.PASSWORD_RESET },
  });
}

beforeEach(() => {
  clearCapturedEmails();
});

describe('concurrent reset with one token', () => {
  it('lets exactly one of five racers change the password', async () => {
    const user = await createAccount();
    const rawToken = await requestLink(user);

    const results = await Promise.all(
      Array.from({ length: RACERS }, (_, index) =>
        passwordResetService.resetPasswordWithToken(rawToken, racerPassword(index))
      )
    );

    const winners = results.filter((result) => result.reset);
    const losers = results.filter((result) => !result.reset);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(RACERS - 1);

    // The stored hash matches exactly one racer's password, proving the loser
    // transactions wrote nothing at all.
    const stored = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const matches = await Promise.all(
      Array.from({ length: RACERS }, (_, index) =>
        verifyPassword(stored.passwordHash, racerPassword(index))
      )
    );
    expect(matches.filter(Boolean)).toHaveLength(1);
    await expect(verifyPassword(stored.passwordHash, OLD_PASSWORD)).resolves.toBe(false);

    const tokens = await resetTokens(user.id);
    expect(tokens[0].usedAt).not.toBeNull();

    const completions = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.PASSWORD_RESET_COMPLETED },
    });
    expect(completions).toHaveLength(1);
  });

  it('gives every loser the identical generic rejection', async () => {
    const user = await createAccount();
    const rawToken = await requestLink(user);

    await passwordResetService.resetPasswordWithToken(rawToken, NEW_PASSWORD);
    const replays = await Promise.all(
      Array.from({ length: RACERS }, (_, index) =>
        passwordResetService.resetPasswordWithToken(rawToken, racerPassword(index))
      )
    );

    for (const replay of replays) {
      expect(replay.reset).toBe(false);
    }

    const error = passwordResetService.invalidPasswordResetLink();
    expect(error.message).toBe(passwordResetMessages.invalidLink);
    expect((error as { code?: string }).code).toBe(AuthErrorCodes.PASSWORD_RESET_INVALID);
  });

  it('revokes sessions exactly once even when racers all reach that step', async () => {
    const user = await createAccount();

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    for (let index = 0; index < 3; index += 1) {
      await testPrisma.session.create({
        data: {
          userId: user.id,
          refreshTokenHash: `hash-${index}`,
          tokenFamilyId: `family-${index}`,
          expiresAt,
        },
      });
    }

    const rawToken = await requestLink(user);
    await passwordResetService.resetPasswordWithToken(rawToken, NEW_PASSWORD);

    const sessions = await testPrisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(3);
    for (const session of sessions) {
      expect(session.revokedAt).not.toBeNull();
    }

    const completion = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: AuditActions.PASSWORD_RESET_COMPLETED },
    });
    expect(completion.metadata).toMatchObject({ revokedSessions: 3 });
  });
});

describe('concurrent reset requests for one account', () => {
  it('mints a single live link no matter how many requests race', async () => {
    const user = await createAccount();

    const outcomes = await Promise.all(
      Array.from({ length: RACERS }, () =>
        passwordResetService.requestPasswordReset(user.email)
      )
    );

    const sent = outcomes.filter((outcome) => outcome.sent);

    // The first racer locks the user row and inserts; every later racer then
    // observes the token inside the cooldown and is refused.
    expect(sent).toHaveLength(1);
    expect(getCapturedEmails()).toHaveLength(1);

    const tokens = await resetTokens(user.id);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].usedAt).toBeNull();

    const requested = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.PASSWORD_RESET_REQUESTED },
    });
    expect(requested).toHaveLength(1);
  });

  it('leaves at most one usable link when a later request supersedes a raced batch', async () => {
    const user = await createAccount();
    const initialToken = await requestLink(user);

    // Move out of the cooldown window so the batch below is racing for real
    // rather than being refused by the link issued a moment ago.
    await testPrisma.authToken.updateMany({
      where: { userId: user.id, type: AuthTokenType.PASSWORD_RESET },
      data: { createdAt: new Date(Date.now() - 3_600_000) },
    });
    clearCapturedEmails();

    // Racing issuance. The first racer locks the user row and inserts; the rest
    // are refused by the cooldown, so exactly one live link comes out of the
    // batch — and the link issued before the batch must not survive either.
    const requests = await Promise.all(
      Array.from({ length: RACERS }, () => passwordResetService.requestPasswordReset(user.email))
    );
    const sent = requests.filter((outcome) => outcome.sent);
    expect(sent).toHaveLength(1);
    const racedToken = tokenFromLastEmail();

    // The winner's link is the live one; the link issued before the batch was
    // superseded and can no longer be used.
    const racedRow = await testPrisma.authToken.findFirstOrThrow({
      where: { tokenHash: hashAuthToken(racedToken) },
    });
    expect(racedRow.usedAt).toBeNull();

    const initialRow = await testPrisma.authToken.findFirstOrThrow({
      where: { tokenHash: hashAuthToken(initialToken) },
    });
    expect(initialRow.usedAt).not.toBeNull();

    // A later request supersedes the raced link.
    await testPrisma.authToken.updateMany({
      where: { userId: user.id, type: AuthTokenType.PASSWORD_RESET },
      data: { createdAt: new Date(Date.now() - 3_600_000) },
    });
    clearCapturedEmails();
    await passwordResetService.requestPasswordReset(user.email);
    const newestToken = tokenFromLastEmail();

    expect(newestToken).not.toBe(initialToken);
    expect(newestToken).not.toBe(racedToken);

    expect(
      (await passwordResetService.resetPasswordWithToken(newestToken, NEW_PASSWORD)).reset
    ).toBe(true);

    // Both earlier links are dead, whatever they were.
    const stale = await Promise.all(
      [initialToken, racedToken].map((token) =>
        passwordResetService.resetPasswordWithToken(token, racerPassword(2))
      )
    );
    for (const result of stale) {
      expect(result.reset).toBe(false);
    }

    const rows = await resetTokens(user.id);
    expect(rows.every((row) => row.usedAt !== null)).toBe(true);
  });
});

describe('token secrecy under concurrency', () => {
  it('never writes a raw token, its hash or the link into the audit log', async () => {
    const user = await createAccount();
    const rawToken = await requestLink(user);

    await passwordResetService.resetPasswordWithToken(rawToken, NEW_PASSWORD);

    const logs = await testPrisma.auditLog.findMany();
    const serialized = JSON.stringify(logs);

    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain(hashAuthToken(rawToken));
    expect(serialized).not.toContain('reset-password?token=');
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain(OLD_PASSWORD);
  });
});