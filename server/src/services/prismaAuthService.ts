import { User, Session, AccountStatus, Role, FinancialProfile, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../types/auth.js';
import { authService } from './authService.js';
import { prisma } from '../config/prisma.js';
import { randomBytes } from 'crypto';

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { id },
    include: { mfa: true },
  });
}

export async function createUserWithProfile(
  email: string,
  passwordHash: string,
  firstName: string,
  lastName: string
): Promise<{ user: User; profile: FinancialProfile }> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role: Role.USER,
        status: AccountStatus.ACTIVE,
      },
    });

    const profile = await tx.financialProfile.create({
      data: {
        userId: user.id,
        currency: 'USD',
      },
    });

    return { user, profile };
  });
}

export async function createSession(
  userId: string,
  refreshTokenHash: string,
  expiresAt: Date,
  tokenFamilyId?: string,
  client?: Prisma.TransactionClient
): Promise<Session> {
  const executor = client ?? prisma;

  return executor.session.create({
    data: {
      userId,
      refreshTokenHash,
      tokenFamilyId: tokenFamilyId ?? randomBytes(16).toString('hex'),
      expiresAt,
    },
  });
}

export async function findSessionByRefreshTokenHash(
  refreshTokenHash: string
): Promise<Session | null> {
  return prisma.session.findFirst({
    where: { refreshTokenHash },
    include: { user: true },
  });
}

export async function detectRefreshTokenReuse(
  refreshTokenHash: string
): Promise<{ session: Session | null; reuseDetected: boolean; tokenFamilyId?: string }> {
  const activeSession = await prisma.session.findFirst({
    where: { refreshTokenHash, revokedAt: null },
    include: { user: true },
  });

  if (activeSession) {
    return { session: activeSession, reuseDetected: false };
  }

  const successor = await prisma.session.findFirst({
    where: { previousRefreshTokenHash: refreshTokenHash },
    include: { user: true },
  });

  if (successor) {
    return { session: successor, reuseDetected: true, tokenFamilyId: successor.tokenFamilyId };
  }

  const revokedSession = await prisma.session.findFirst({
    where: { refreshTokenHash },
    include: { user: true },
  });

  if (revokedSession) {
    return { session: revokedSession, reuseDetected: false };
  }

  return { session: null, reuseDetected: false };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revokes every live session for a user. This is the existing logout-all
 * mechanism, reused by the password-reset flow.
 *
 * `client` lets the caller join an open transaction so that revoking sessions,
 * writing a new password hash and consuming the reset token commit together.
 * That matters: revoking sessions on a separate connection after the password
 * change commits would leave a window in which the new password is live while
 * old sessions still work.
 */
export async function revokeAllUserSessions(
  userId: string,
  client?: Prisma.TransactionClient
): Promise<number> {
  const executor = client ?? prisma;

  const result = await executor.session.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Revokes every live session for a user except one that must survive — used
 * when enabling or disabling 2FA so the session performing the change stays
 * signed in while every other session (which may or may not have passed the
 * second factor) is killed.
 */
export async function revokeAllUserSessionsExcept(
  userId: string,
  keepSessionId: string,
  client?: Prisma.TransactionClient
): Promise<number> {
  const executor = client ?? prisma;

  const result = await executor.session.updateMany({
    where: {
      userId,
      id: { not: keepSessionId },
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function updateLastLoginAt(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}

export async function isUserActive(user: User): Promise<boolean> {
  return user.status === AccountStatus.ACTIVE;
}

export async function getAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { mfa: true },
  });

  if (!user) return null;

  return authService.toAuthenticatedUser(user);
}

/**
 * Atomically consumes the current refresh token and creates its successor.
 *
 * The old token is consumed by a conditional `updateMany` (compare-and-swap)
 * whose predicate is `id AND refreshTokenHash AND revokedAt IS NULL`, so the
 * database — not application code — decides which concurrent request wins.
 * Exactly one caller can observe `count === 1`; every other caller racing on
 * the same token observes `count === 0` and gets `{ rotated: false }` without
 * a successor row ever being written. Under READ COMMITTED the loser's
 * `UPDATE` re-evaluates its predicate against the winner's committed tuple,
 * so the unconditional-update TOCTOU cannot occur.
 *
 * The expected hash is supplied by the caller (the hash of the token actually
 * presented in the request), binding consumption to the exact token observed.
 */
export async function rotateSession(
  oldSessionId: string,
  expectedRefreshTokenHash: string,
  newRefreshTokenHash: string,
  newExpiresAt: Date
): Promise<{ rotated: boolean; successor: Session | null }> {
  return prisma.$transaction(async (tx) => {
    const oldSession = await tx.session.findUnique({
      where: { id: oldSessionId },
    });

    if (!oldSession) {
      throw new Error('Session not found');
    }

    const consumed = await tx.session.updateMany({
      where: {
        id: oldSessionId,
        refreshTokenHash: expectedRefreshTokenHash,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    if (consumed.count !== 1) {
      return { rotated: false, successor: null };
    }

    const successor = await tx.session.create({
      data: {
        userId: oldSession.userId,
        refreshTokenHash: newRefreshTokenHash,
        previousRefreshTokenHash: oldSession.refreshTokenHash,
        tokenFamilyId: oldSession.tokenFamilyId,
        expiresAt: newExpiresAt,
      },
    });

    return { rotated: true, successor };
  });
}

export async function revokeTokenFamily(tokenFamilyId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      tokenFamilyId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}