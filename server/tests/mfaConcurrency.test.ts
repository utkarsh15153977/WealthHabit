import { describe, it, expect } from 'vitest';
import { AccountStatus, AuthTokenType, Role } from '@prisma/client';
import { Authenticator } from '@otplib/core';
import { createDigest, createRandomBytes } from '@otplib/plugin-crypto';
import { keyDecoder, keyEncoder } from '@otplib/plugin-thirty-two';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword } from '../src/services/authService.js';
import { mfaService, hashRecoveryCode } from '../src/services/mfaService.js';
import { hashAuthToken } from '../src/services/authTokenService.js';
import { AuditActions } from '../src/services/auditLogService.js';

const PASSWORD = 'CurrentPassword123!';
const RACERS = 5;

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

function currentCode(secret: string): string {
  return testAuthenticator(Date.now()).generate(secret);
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

async function enable2fa(userId: string) {
  const { secret } = await mfaService.startMfaSetup({ userId, currentPassword: PASSWORD });
  const enabled = await mfaService.enableMfa({ userId, code: currentCode(secret), keepSessionId: null });
  return { secret, recoveryCodes: enabled.recoveryCodes };
}

describe('concurrent 2FA enable', () => {
  it('lets exactly one of five confirmations succeed with one recovery page committed', async () => {
    const user = await createUser();
    const { secret } = await mfaService.startMfaSetup({ userId: user.id, currentPassword: PASSWORD });

    const results = await Promise.allSettled(
      Array.from({ length: RACERS }, () =>
        mfaService.enableMfa({ userId: user.id, code: currentCode(secret), keepSessionId: null })
      )
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof mfaService.enableMfa>>
    >[];
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(RACERS - 1);

    // The committed recovery page is exactly the winner's — a loser's page,
    // generated but discarded, must not be present.
    const winnerCodes = fulfilled[0].value.recoveryCodes;
    const hashes = await testPrisma.recoveryCode.findMany({ where: { userId: user.id } });
    expect(hashes).toHaveLength(10);
    for (const code of winnerCodes) {
      expect(hashes.map((h) => h.codeHash)).toContain(hashRecoveryCode(code));
    }

    const row = await testPrisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.enabledAt).not.toBeNull();

    const audits = await testPrisma.auditLog.findMany({ where: { action: AuditActions.MFA_ENABLED } });
    expect(audits).toHaveLength(1);
  });
});

describe('concurrent TOTP login against one challenge', () => {
  it('creates exactly one session and consumes the challenge once', async () => {
    const user = await createUser();
    const { secret } = await enable2fa(user.id);
    const { challengeToken } = await mfaService.createLoginChallenge(user.id);

    const results = await Promise.all(
      Array.from({ length: RACERS }, () => mfaService.verifyMfaLoginChallenge(challengeToken, currentCode(secret)))
    );

    const winners = results.filter((r) => r.signedIn);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => !r.signedIn)).toHaveLength(RACERS - 1);

    expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(1);

    const tokens = await testPrisma.authToken.findMany({
      where: { userId: user.id, tokenHash: hashAuthToken(challengeToken) },
    });
    expect(tokens[0].usedAt).not.toBeNull();

    const audits = await testPrisma.auditLog.findMany({ where: { action: AuditActions.MFA_LOGIN_SUCCESS } });
    expect(audits).toHaveLength(1);
  });
});

describe('concurrent recovery login with different codes against one challenge', () => {
  it('funds the login with exactly one code and leaves the other unspent', async () => {
    const user = await createUser();
    const { recoveryCodes } = await enable2fa(user.id);
    const { challengeToken } = await mfaService.createLoginChallenge(user.id);

    const results = await Promise.all([
      mfaService.verifyMfaLoginRecoveryCode(challengeToken, recoveryCodes[0]),
      mfaService.verifyMfaLoginRecoveryCode(challengeToken, recoveryCodes[1]),
    ]);

    const winners = results.filter((r) => r.signedIn);
    expect(winners).toHaveLength(1);

    const rows = await testPrisma.recoveryCode.findMany({
      where: { userId: user.id, codeHash: { in: [hashRecoveryCode(recoveryCodes[0]), hashRecoveryCode(recoveryCodes[1])] } },
    });
    expect(rows.filter((r) => r.usedAt !== null)).toHaveLength(1);
    expect(rows.filter((r) => r.usedAt === null)).toHaveLength(1);

    expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(await testPrisma.auditLog.count({ where: { action: AuditActions.MFA_RECOVERY_CODE_USED } })).toBe(1);
  });
});

describe('concurrent challenge issuance', () => {
  it('leaves exactly one live challenge token no matter how many logins race', async () => {
    const user = await createUser();
    await enable2fa(user.id);

    await Promise.all(
      Array.from({ length: RACERS }, () => mfaService.createLoginChallenge(user.id))
    );

    const tokens = await testPrisma.authToken.findMany({
      where: { userId: user.id, type: AuthTokenType.MFA_CHALLENGE },
    });

    expect(tokens.length).toBe(RACERS);
    expect(tokens.filter((t) => t.usedAt === null)).toHaveLength(1);

    // Every other minted challenge was loudly revoked so none can be replayed.
    expect(tokens.filter((t) => t.usedAt !== null)).toHaveLength(RACERS - 1);
  });
});