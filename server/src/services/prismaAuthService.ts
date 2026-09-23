import { PrismaClient, User, Session, AccountStatus, Role, FinancialProfile } from '@prisma/client';
import { AuthenticatedUser } from '../types/auth.js';
import { authService } from './authService.js';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { id },
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
  tokenFamilyId?: string
): Promise<Session> {
  return prisma.session.create({
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

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
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
  });

  if (!user) return null;

  return authService.toAuthenticatedUser(user);
}

export async function rotateSession(
  oldSessionId: string,
  newRefreshTokenHash: string,
  newExpiresAt: Date
): Promise<Session> {
  return prisma.$transaction(async (tx) => {
    const oldSession = await tx.session.findUnique({
      where: { id: oldSessionId },
    });

    if (!oldSession) {
      throw new Error('Session not found');
    }

    await tx.session.update({
      where: { id: oldSessionId },
      data: { revokedAt: new Date() },
    });

    return tx.session.create({
      data: {
        userId: oldSession.userId,
        refreshTokenHash: newRefreshTokenHash,
        previousRefreshTokenHash: oldSession.refreshTokenHash,
        tokenFamilyId: oldSession.tokenFamilyId,
        expiresAt: newExpiresAt,
      },
    });
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