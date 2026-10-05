import { describe, it, expect, beforeEach } from 'vitest';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword } from '../src/services/authService.js';
import { Role, AccountStatus, AuthTokenType } from '@prisma/client';
import {
  createAuthToken,
  verifyAuthToken,
  revokeUserAuthTokens,
  cleanupExpiredAuthTokens,
  setPrismaClient,
} from '../src/services/authTokenService.js';

describe('AuthToken Service', () => {
  let testUser: { email: string; password: string; firstName: string; lastName: string };
  let passwordHash: string;
  let userId: string;

  beforeEach(async () => {
    setPrismaClient(testPrisma);

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
  });

  describe('createAuthToken', () => {
    it('should create email verification token', async () => {
      const { rawToken, tokenHash } = await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);

      expect(rawToken).toBeDefined();
      expect(typeof rawToken).toBe('string');
      expect(rawToken.length).toBe(64);
      expect(tokenHash).toBeDefined();
      expect(tokenHash.length).toBe(64);

      const token = await testPrisma.authToken.findFirst({
        where: { userId, type: AuthTokenType.EMAIL_VERIFICATION },
      });

      expect(token).not.toBeNull();
      expect(token?.tokenHash).toBe(tokenHash);
      expect(token?.type).toBe(AuthTokenType.EMAIL_VERIFICATION);
      expect(token?.usedAt).toBeNull();
      expect(token?.expiresAt).toBeDefined();
    });

    it('should create password reset token', async () => {
      const { rawToken, tokenHash } = await createAuthToken(userId, AuthTokenType.PASSWORD_RESET);

      expect(rawToken).toBeDefined();
      expect(tokenHash).toBeDefined();

      const token = await testPrisma.authToken.findFirst({
        where: { userId, type: AuthTokenType.PASSWORD_RESET },
      });

      expect(token).not.toBeNull();
      expect(token?.tokenHash).toBe(tokenHash);
      expect(token?.type).toBe(AuthTokenType.PASSWORD_RESET);
    });

    it('should generate different tokens each time', async () => {
      const { rawToken: token1 } = await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);
      const { rawToken: token2 } = await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);

      expect(token1).not.toBe(token2);
    });

    it('should only store hash, not raw token', async () => {
      const { rawToken, tokenHash } = await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);

      const token = await testPrisma.authToken.findFirst({
        where: { userId, type: AuthTokenType.EMAIL_VERIFICATION },
      });

      expect(token?.tokenHash).toBe(tokenHash);
      expect(token?.tokenHash).not.toBe(rawToken);
    });
  });

  describe('verifyAuthToken', () => {
    it('should verify valid token', async () => {
      const { rawToken } = await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);

      const result = await verifyAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION, rawToken);

      expect(result.valid).toBe(true);
      expect(result.tokenId).toBeDefined();

      const token = await testPrisma.authToken.findUnique({
        where: { id: result.tokenId },
      });
      expect(token?.usedAt).not.toBeNull();
    });

    it('should reject invalid token', async () => {
      await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);

      const result = await verifyAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION, 'invalid-token');

      expect(result.valid).toBe(false);
    });

    it('should reject token for wrong user', async () => {
      const { rawToken } = await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);

      const otherUser = await testPrisma.user.create({
        data: {
          email: createTestUser().email,
          passwordHash,
          firstName: 'Other',
          lastName: 'User',
          role: Role.USER,
          status: AccountStatus.ACTIVE,
        },
      });

      const result = await verifyAuthToken(otherUser.id, AuthTokenType.EMAIL_VERIFICATION, rawToken);

      expect(result.valid).toBe(false);
    });

    it('should reject token of wrong type', async () => {
      const { rawToken } = await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);

      const result = await verifyAuthToken(userId, AuthTokenType.PASSWORD_RESET, rawToken);

      expect(result.valid).toBe(false);
    });

    it('should reject expired token', async () => {
      const { rawToken } = await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);

      const tokenRecord = await testPrisma.authToken.findFirst({
        where: { userId, type: AuthTokenType.EMAIL_VERIFICATION },
      });

      await testPrisma.authToken.update({
        where: { id: tokenRecord!.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const result = await verifyAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION, rawToken);

      expect(result.valid).toBe(false);
    });

    it('should reject already used token', async () => {
      const { rawToken } = await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);

      await verifyAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION, rawToken);

      const result = await verifyAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION, rawToken);

      expect(result.valid).toBe(false);
    });

    // --- DB-002: atomic single-use consumption under concurrency ---

    it('should allow only one concurrent consumption of the same token', async () => {
      const { rawToken, tokenHash } = await createAuthToken(
        userId,
        AuthTokenType.EMAIL_VERIFICATION
      );

      const unused = await testPrisma.authToken.findFirst({ where: { userId, tokenHash } });
      expect(unused?.usedAt).toBeNull();

      // Two genuinely concurrent callers race for one single-use token. No
      // timers, sleeps or artificial delays are used: the winner is decided by
      // the conditional UPDATE inside the database, so the invariant under test
      // is "exactly one consumption" regardless of how the calls interleave.
      const results = await Promise.all([
        verifyAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION, rawToken),
        verifyAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION, rawToken),
      ]);

      const winners = results.filter((result) => result.valid);
      const losers = results.filter((result) => !result.valid);

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);

      // Loser contract: a plain failure result, no exception, no token id.
      expect(losers[0]).toEqual({ valid: false });
      expect(losers[0].tokenId).toBeUndefined();

      // Winner received the consumed token id.
      expect(winners[0].tokenId).toBe(unused!.id);

      // Database invariant: one row, consumed exactly once.
      const rows = await testPrisma.authToken.findMany({ where: { userId, tokenHash } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(unused!.id);
      expect(rows[0].usedAt).not.toBeNull();
    });

    it('should consume the token exactly once under 5-way concurrent contention', async () => {
      const { rawToken, tokenHash } = await createAuthToken(userId, AuthTokenType.PASSWORD_RESET);

      const unused = await testPrisma.authToken.findFirst({ where: { userId, tokenHash } });

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          verifyAuthToken(userId, AuthTokenType.PASSWORD_RESET, rawToken)
        )
      );

      const winners = results.filter((result) => result.valid);
      const losers = results.filter((result) => !result.valid);

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(4);
      expect(losers.every((result) => result.tokenId === undefined)).toBe(true);
      expect(winners[0].tokenId).toBe(unused!.id);

      const rows = await testPrisma.authToken.findMany({ where: { userId, tokenHash } });
      expect(rows).toHaveLength(1);
      expect(rows[0].usedAt).not.toBeNull();
    });

    it('should not consume the token on concurrent wrong-user or wrong-type attempts', async () => {
      const { rawToken, tokenHash } = await createAuthToken(
        userId,
        AuthTokenType.EMAIL_VERIFICATION
      );

      const otherUser = await testPrisma.user.create({
        data: {
          email: createTestUser().email,
          passwordHash,
          firstName: 'Other',
          lastName: 'User',
          role: Role.USER,
          status: AccountStatus.ACTIVE,
        },
      });

      const results = await Promise.all([
        verifyAuthToken(otherUser.id, AuthTokenType.EMAIL_VERIFICATION, rawToken),
        verifyAuthToken(userId, AuthTokenType.PASSWORD_RESET, rawToken),
        verifyAuthToken(otherUser.id, AuthTokenType.PASSWORD_RESET, rawToken),
      ]);

      expect(results.every((result) => result.valid === false)).toBe(true);
      expect(results.every((result) => result.tokenId === undefined)).toBe(true);

      // The legitimate token must remain unused and still consumable.
      const row = await testPrisma.authToken.findFirst({ where: { userId, tokenHash } });
      expect(row?.usedAt).toBeNull();

      const owner = await verifyAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION, rawToken);
      expect(owner.valid).toBe(true);
      expect(owner.tokenId).toBe(row!.id);
    });
  });

  describe('revokeUserAuthTokens', () => {
    it('should revoke all tokens for user', async () => {
      await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);
      await createAuthToken(userId, AuthTokenType.PASSWORD_RESET);

      await revokeUserAuthTokens(userId);

      const tokens = await testPrisma.authToken.findMany({
        where: { userId, usedAt: null },
      });
      expect(tokens.length).toBe(0);
    });

    it('should revoke only specified type', async () => {
      await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);
      await createAuthToken(userId, AuthTokenType.PASSWORD_RESET);

      await revokeUserAuthTokens(userId, AuthTokenType.EMAIL_VERIFICATION);

      const emailTokens = await testPrisma.authToken.findMany({
        where: { userId, type: AuthTokenType.EMAIL_VERIFICATION, usedAt: null },
      });
      expect(emailTokens.length).toBe(0);

      const resetTokens = await testPrisma.authToken.findMany({
        where: { userId, type: AuthTokenType.PASSWORD_RESET, usedAt: null },
      });
      expect(resetTokens.length).toBe(1);
    });
  });

  describe('cleanupExpiredAuthTokens', () => {
    it('should delete expired tokens', async () => {
      await createAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION);

      const tokenRecord = await testPrisma.authToken.findFirst({
        where: { userId, type: AuthTokenType.EMAIL_VERIFICATION },
      });

      await testPrisma.authToken.update({
        where: { id: tokenRecord!.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await createAuthToken(userId, AuthTokenType.PASSWORD_RESET);

      const count = await cleanupExpiredAuthTokens();

      expect(count).toBe(1);

      const remaining = await testPrisma.authToken.findMany({
        where: { userId },
      });
      expect(remaining.length).toBe(1);
      expect(remaining[0].type).toBe(AuthTokenType.PASSWORD_RESET);
    });
  });
});