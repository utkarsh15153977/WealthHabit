import { randomBytes, createHash } from 'crypto';
import { PrismaClient, AuthTokenType } from '@prisma/client';

let prisma: PrismaClient;

export function setPrismaClient(client: PrismaClient): void {
  prisma = client;
}

function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

function generateRawToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createAuthToken(
  userId: string,
  type: AuthTokenType,
  expiresInHours = 24
): Promise<{ rawToken: string; tokenHash: string }> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await getPrisma().authToken.create({
    data: {
      userId,
      tokenHash,
      type,
      expiresAt,
    },
  });

  return { rawToken, tokenHash };
}

export async function verifyAuthToken(
  userId: string,
  type: AuthTokenType,
  rawToken: string
): Promise<{ valid: boolean; tokenId?: string }> {
  const tokenHash = hashToken(rawToken);

  const token = await getPrisma().authToken.findFirst({
    where: {
      userId,
      type,
      tokenHash,
      expiresAt: { gt: new Date() },
      usedAt: null,
    },
  });

  if (!token) {
    return { valid: false };
  }

  await getPrisma().authToken.update({
    where: { id: token.id },
    data: { usedAt: new Date() },
  });

  return { valid: true, tokenId: token.id };
}

export async function revokeUserAuthTokens(userId: string, type?: AuthTokenType): Promise<void> {
  await getPrisma().authToken.updateMany({
    where: {
      userId,
      ...(type ? { type } : {}),
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });
}

export async function cleanupExpiredAuthTokens(): Promise<number> {
  const result = await getPrisma().authToken.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}