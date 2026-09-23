import { describe, it, expect, beforeEach } from 'vitest';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword } from '../src/services/authService.js';
import { authService } from '../src/services/authService.js';
import {
  findUserByEmail,
  findUserById,
  createUserWithProfile,
  createSession,
  findSessionByRefreshTokenHash,
  revokeSession,
  revokeAllUserSessions,
  updateLastLoginAt,
  isUserActive,
  getAuthenticatedUser,
  rotateSession,
  detectRefreshTokenReuse,
  revokeTokenFamily,
} from '../src/services/prismaAuthService.js';
import { Role, AccountStatus } from '@prisma/client';

describe('Prisma Auth Service', () => {
  let testUser: { email: string; password: string; firstName: string; lastName: string };
  let passwordHash: string;

  beforeEach(async () => {
    testUser = createTestUser();
    passwordHash = await hashPassword(testUser.password);
  });

  describe('findUserByEmail', () => {
    it('should return null for non-existent email', async () => {
      const user = await findUserByEmail('nonexistent@example.com');
      expect(user).toBeNull();
    });

    it('should find user by email', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const found = await findUserByEmail(testUser.email);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(user.id);
      expect(found?.email).toBe(testUser.email.toLowerCase());
    });

    it('should normalize email case', async () => {
      await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const found = await findUserByEmail(testUser.email.toUpperCase());
      expect(found).not.toBeNull();
    });
  });

  describe('findUserById', () => {
    it('should return null for non-existent id', async () => {
      const user = await findUserById('non-existent-id');
      expect(user).toBeNull();
    });

    it('should find user by id', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const found = await findUserById(user.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(user.id);
    });
  });

  describe('createUserWithProfile', () => {
    it('should create user with profile', async () => {
      const { user, profile } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      expect(user).toBeDefined();
      expect(user.email).toBe(testUser.email.toLowerCase());
      expect(user.firstName).toBe(testUser.firstName);
      expect(user.lastName).toBe(testUser.lastName);
      expect(user.role).toBe(Role.USER);
      expect(user.status).toBe(AccountStatus.ACTIVE);
      expect(user.passwordHash).toBe(passwordHash);

      expect(profile).toBeDefined();
      expect(profile.userId).toBe(user.id);
      expect(profile.currency).toBe('USD');
    });

    it('should enforce unique email', async () => {
      await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      await expect(
        createUserWithProfile(
          testUser.email,
          passwordHash,
          'Different',
          'User'
        )
      ).rejects.toThrow();
    });
  });

  describe('createSession', () => {
    it('should create a session', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const refreshToken = authService.generateRefreshToken();
      const refreshTokenHash = authService.hashRefreshToken(refreshToken);
      const expiresAt = authService.calculateRefreshExpiry();

      const session = await createSession(user.id, refreshTokenHash, expiresAt);

      expect(session).toBeDefined();
      expect(session.userId).toBe(user.id);
      expect(session.refreshTokenHash).toBe(refreshTokenHash);
      expect(session.expiresAt).toEqual(expiresAt);
      expect(session.revokedAt).toBeNull();
    });
  });

  describe('findSessionByRefreshTokenHash', () => {
    it('should return null for non-existent hash', async () => {
      const session = await findSessionByRefreshTokenHash('non-existent-hash');
      expect(session).toBeNull();
    });

    it('should find session by refresh token hash', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const refreshToken = authService.generateRefreshToken();
      const refreshTokenHash = authService.hashRefreshToken(refreshToken);
      const expiresAt = authService.calculateRefreshExpiry();

      await createSession(user.id, refreshTokenHash, expiresAt);

      const session = await findSessionByRefreshTokenHash(refreshTokenHash);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe(user.id);
      expect(session?.user).toBeDefined();
    });
  });

  describe('revokeSession', () => {
    it('should revoke a session', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const refreshToken = authService.generateRefreshToken();
      const refreshTokenHash = authService.hashRefreshToken(refreshToken);
      const expiresAt = authService.calculateRefreshExpiry();

      const session = await createSession(user.id, refreshTokenHash, expiresAt);

      await revokeSession(session.id);

      const revoked = await findSessionByRefreshTokenHash(refreshTokenHash);
      expect(revoked?.revokedAt).not.toBeNull();
    });
  });

  describe('revokeAllUserSessions', () => {
    it('should revoke all sessions for a user', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const expiresAt = authService.calculateRefreshExpiry();
      await createSession(user.id, authService.hashRefreshToken(authService.generateRefreshToken()), expiresAt);
      await createSession(user.id, authService.hashRefreshToken(authService.generateRefreshToken()), expiresAt);
      await createSession(user.id, authService.hashRefreshToken(authService.generateRefreshToken()), expiresAt);

      const count = await revokeAllUserSessions(user.id);
      expect(count).toBe(3);

      const sessions = await testPrisma.session.findMany({
        where: { userId: user.id, revokedAt: null },
      });
      expect(sessions.length).toBe(0);
    });
  });

  describe('updateLastLoginAt', () => {
    it('should update lastLoginAt', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      expect(user.lastLoginAt).toBeNull();

      await updateLastLoginAt(user.id);

      const updated = await findUserById(user.id);
      expect(updated?.lastLoginAt).not.toBeNull();
    });
  });

  describe('isUserActive', () => {
    it('should return true for active user', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const active = await isUserActive(user);
      expect(active).toBe(true);
    });

    it('should return false for suspended user', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      await testPrisma.user.update({
        where: { id: user.id },
        data: { status: AccountStatus.SUSPENDED },
      });

      const updatedUser = await testPrisma.user.findUnique({ where: { id: user.id } });
      const active = await isUserActive(updatedUser!);
      expect(active).toBe(false);
    });

    it('should return false for deactivated user', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      await testPrisma.user.update({
        where: { id: user.id },
        data: { status: AccountStatus.DEACTIVATED },
      });

      const updatedUser = await testPrisma.user.findUnique({ where: { id: user.id } });
      const active = await isUserActive(updatedUser!);
      expect(active).toBe(false);
    });
  });

  describe('getAuthenticatedUser', () => {
    it('should return authenticated user', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const authUser = await getAuthenticatedUser(user.id);
      expect(authUser).not.toBeNull();
      expect(authUser?.id).toBe(user.id);
      expect(authUser?.email).toBe(user.email);
      expect(authUser?.firstName).toBe(user.firstName);
      expect(authUser?.lastName).toBe(user.lastName);
      expect(authUser?.role).toBe(user.role);
      expect(authUser?.status).toBe(user.status);
      expect(authUser).not.toHaveProperty('passwordHash');
    });

    it('should return null for non-existent user', async () => {
      const authUser = await getAuthenticatedUser('non-existent-id');
      expect(authUser).toBeNull();
    });
  });

  describe('rotateSession', () => {
    it('should rotate session and create new one', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const refreshToken = authService.generateRefreshToken();
      const refreshTokenHash = authService.hashRefreshToken(refreshToken);
      const expiresAt = authService.calculateRefreshExpiry();

      const session = await createSession(user.id, refreshTokenHash, expiresAt);

      const newRefreshToken = authService.generateRefreshToken();
      const newRefreshTokenHash = authService.hashRefreshToken(newRefreshToken);
      const newExpiresAt = authService.calculateRefreshExpiry();

      const newSession = await rotateSession(session.id, newRefreshTokenHash, newExpiresAt);

      expect(newSession.id).not.toBe(session.id);
      expect(newSession.refreshTokenHash).toBe(newRefreshTokenHash);
      expect(newSession.userId).toBe(user.id);
      expect(newSession.tokenFamilyId).toBe(session.tokenFamilyId);
      expect(newSession.previousRefreshTokenHash).toBe(session.refreshTokenHash);

      const oldSession = await testPrisma.session.findUnique({
        where: { id: session.id },
      });
      expect(oldSession?.revokedAt).not.toBeNull();
    });
  });

  describe('detectRefreshTokenReuse', () => {
    it('should return session with reuseDetected=false for valid current token', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const refreshToken = authService.generateRefreshToken();
      const refreshTokenHash = authService.hashRefreshToken(refreshToken);
      const expiresAt = authService.calculateRefreshExpiry();

      await createSession(user.id, refreshTokenHash, expiresAt);

      const result = await detectRefreshTokenReuse(refreshTokenHash);

      expect(result.session).not.toBeNull();
      expect(result.reuseDetected).toBe(false);
      expect(result.tokenFamilyId).toBeUndefined();
    });

    it('should return null session for completely unknown token', async () => {
      const result = await detectRefreshTokenReuse('unknown-token-hash');

      expect(result.session).toBeNull();
      expect(result.reuseDetected).toBe(false);
    });

    it('should detect reuse when old rotated token is presented', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const refreshToken = authService.generateRefreshToken();
      const refreshTokenHash = authService.hashRefreshToken(refreshToken);
      const expiresAt = authService.calculateRefreshExpiry();

      const session = await createSession(user.id, refreshTokenHash, expiresAt);

      const newRefreshToken = authService.generateRefreshToken();
      const newRefreshTokenHash = authService.hashRefreshToken(newRefreshToken);
      const newExpiresAt = authService.calculateRefreshExpiry();

      await rotateSession(session.id, newRefreshTokenHash, newExpiresAt);

      const result = await detectRefreshTokenReuse(refreshTokenHash);

      expect(result.session).not.toBeNull();
      expect(result.reuseDetected).toBe(true);
      expect(result.tokenFamilyId).toBe(session.tokenFamilyId);
    });

    it('should not detect reuse for the new rotated token', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const refreshToken = authService.generateRefreshToken();
      const refreshTokenHash = authService.hashRefreshToken(refreshToken);
      const expiresAt = authService.calculateRefreshExpiry();

      const session = await createSession(user.id, refreshTokenHash, expiresAt);

      const newRefreshToken = authService.generateRefreshToken();
      const newRefreshTokenHash = authService.hashRefreshToken(newRefreshToken);
      const newExpiresAt = authService.calculateRefreshExpiry();

      await rotateSession(session.id, newRefreshTokenHash, newExpiresAt);

      const result = await detectRefreshTokenReuse(newRefreshTokenHash);

      expect(result.session).not.toBeNull();
      expect(result.reuseDetected).toBe(false);
    });
  });

  describe('revokeTokenFamily', () => {
    it('should revoke all sessions in a token family', async () => {
      const { user } = await createUserWithProfile(
        testUser.email,
        passwordHash,
        testUser.firstName,
        testUser.lastName
      );

      const refreshToken = authService.generateRefreshToken();
      const refreshTokenHash = authService.hashRefreshToken(refreshToken);
      const expiresAt = authService.calculateRefreshExpiry();

      const session = await createSession(user.id, refreshTokenHash, expiresAt);
      const tokenFamilyId = session.tokenFamilyId;

      const newRefreshToken = authService.generateRefreshToken();
      const newRefreshTokenHash = authService.hashRefreshToken(newRefreshToken);
      const newExpiresAt = authService.calculateRefreshExpiry();

      await rotateSession(session.id, newRefreshTokenHash, newExpiresAt);

      const count = await revokeTokenFamily(tokenFamilyId);

      expect(count).toBe(1);

      const sessions = await testPrisma.session.findMany({
        where: { tokenFamilyId, revokedAt: null },
      });
      expect(sessions.length).toBe(0);
    });
  });
});