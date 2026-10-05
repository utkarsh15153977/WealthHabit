import { describe, it, expect, beforeEach } from 'vitest';
import { AuthTokenType, Role, AccountStatus } from '@prisma/client';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword } from '../src/services/authService.js';
import { AuditActions } from '../src/services/auditLogService.js';
import {
  clearCapturedEmails,
  getCapturedEmails,
} from '../src/services/emailService.js';
import {
  emailVerificationService,
  emailVerificationMessages,
} from '../src/services/emailVerificationService.js';
import { hashAuthToken } from '../src/services/authTokenService.js';
import { AuthErrorCodes } from '../src/types/auth.js';

const RACERS = 5;

async function createUnverifiedUser() {
  const payload = createTestUser();

  return testPrisma.user.create({
    data: {
      email: payload.email,
      passwordHash: await hashPassword(payload.password),
      firstName: payload.firstName,
      lastName: payload.lastName,
      role: Role.USER,
      status: AccountStatus.ACTIVE,
    },
  });
}

async function outstandingTokens(userId: string) {
  return testPrisma.authToken.findMany({
    where: { userId, type: AuthTokenType.EMAIL_VERIFICATION },
  });
}

beforeEach(() => {
  clearCapturedEmails();
});

describe('concurrent verification of one token', () => {
  it('lets exactly one of five racers win and consumes the token once', async () => {
    const user = await createUnverifiedUser();

    await emailVerificationService.issueInitialEmailVerification({
      userId: user.id,
      firstName: user.firstName,
      to: user.email,
    });

    const emails = getCapturedEmails();
    const rawToken = /verify-email\?token=([0-9a-f]+)/.exec(emails[0].html)![1];

    const results = await Promise.all(
      Array.from({ length: RACERS }, () =>
        emailVerificationService.verifyEmailWithToken(rawToken)
      )
    );

    const winners = results.filter((result) => result.verified);
    const losers = results.filter((result) => !result.verified);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(RACERS - 1);

    const stored = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).not.toBeNull();

    const tokens = await outstandingTokens(user.id);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].usedAt).not.toBeNull();

    const verified = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.EMAIL_VERIFIED },
    });
    expect(verified).toHaveLength(1);
  });

  it('gives every loser the identical generic rejection', async () => {
    const user = await createUnverifiedUser();

    await emailVerificationService.issueInitialEmailVerification({
      userId: user.id,
      firstName: user.firstName,
      to: user.email,
    });

    const rawToken = /verify-email\?token=([0-9a-f]+)/.exec(getCapturedEmails()[0].html)![1];

    await emailVerificationService.verifyEmailWithToken(rawToken);
    const replays = await Promise.all(
      Array.from({ length: RACERS }, () =>
        emailVerificationService.verifyEmailWithToken(rawToken)
      )
    );

    for (const replay of replays) {
      expect(replay.verified).toBe(false);
    }

    const error = emailVerificationService.invalidEmailVerificationLink();
    expect(error.message).toBe(emailVerificationMessages.invalidLink);
    expect((error as { code?: string }).code).toBe(AuthErrorCodes.EMAIL_VERIFICATION_INVALID);
  });
});

describe('concurrent resend for one account', () => {
  it('mints a single live token no matter how many resends race', async () => {
    const user = await createUnverifiedUser();

    const outcomes = await Promise.all(
      Array.from({ length: RACERS }, () =>
        emailVerificationService.resendEmailVerification(user.email)
      )
    );

    const sent = outcomes.filter((outcome) => outcome.sent);

    // The first racer locks the row and inserts a token; every later racer then
    // sees it inside the cooldown and is refused.
    expect(sent).toHaveLength(1);
    expect(getCapturedEmails()).toHaveLength(1);

    const tokens = await outstandingTokens(user.id);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].usedAt).toBeNull();

    const issued = await testPrisma.auditLog.findMany({
      where: { action: AuditActions.EMAIL_VERIFICATION_RESENT },
    });
    expect(issued).toHaveLength(1);
  });

  it('leaves at most one usable link after a superseding resend', async () => {
    const user = await createUnverifiedUser();

    await emailVerificationService.issueInitialEmailVerification({
      userId: user.id,
      firstName: user.firstName,
      to: user.email,
    });
    const initialToken = /verify-email\?token=([0-9a-f]+)/.exec(getCapturedEmails()[0].html)![1];

    await testPrisma.authToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    clearCapturedEmails();

    await emailVerificationService.resendEmailVerification(user.email);
    const resentToken = /verify-email\?token=([0-9a-f]+)/.exec(getCapturedEmails()[0].html)![1];

    expect(resentToken).not.toBe(initialToken);

    const stale = await emailVerificationService.verifyEmailWithToken(initialToken);
    const fresh = await emailVerificationService.verifyEmailWithToken(resentToken);

    expect(stale.verified).toBe(false);
    expect(fresh.verified).toBe(true);

    // The superseded token is revoked, not merely expired.
    const staleRow = await testPrisma.authToken.findFirstOrThrow({
      where: { tokenHash: hashAuthToken(initialToken) },
    });
    expect(staleRow.usedAt).not.toBeNull();
  });
});

describe('token secrecy', () => {
  it('never writes the raw token or its link into the audit log', async () => {
    const user = await createUnverifiedUser();

    await emailVerificationService.issueInitialEmailVerification({
      userId: user.id,
      firstName: user.firstName,
      to: user.email,
    });
    const rawToken = /verify-email\?token=([0-9a-f]+)/.exec(getCapturedEmails()[0].html)![1];

    await emailVerificationService.verifyEmailWithToken(rawToken);

    const logs = await testPrisma.auditLog.findMany();
    const serialized = JSON.stringify(logs);

    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain(hashAuthToken(rawToken));
    expect(serialized).not.toContain('verify-email?token=');
  });
});