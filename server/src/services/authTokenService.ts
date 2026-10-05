import { randomBytes, createHash } from 'crypto';
import { PrismaClient, AuthTokenType } from '@prisma/client';
import { prisma as sharedPrisma } from '../config/prisma.js';

let prisma: PrismaClient | null = null;

export function setPrismaClient(client: PrismaClient): void {
  prisma = client;
}

function getPrisma(): PrismaClient {
  return prisma ?? sharedPrisma;
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

/**
 * Atomically consumes a single-use auth token and returns its id.
 *
 * Consumption is ONE conditional `UPDATE ... RETURNING` statement whose
 * predicate includes `usedAt IS NULL`, so the database - not application code -
 * decides which concurrent request wins. The winner observes exactly one
 * returned row; every other caller racing on the same token matches zero rows
 * and gets `{ valid: false }` without consuming anything.
 *
 * Under READ COMMITTED the loser's `UPDATE` re-evaluates its predicate against
 * the winner's committed tuple: `usedAt` is no longer NULL, so the row is
 * filtered out. This is why the consumed-state predicate must live inside the
 * UPDATE. The previous implementation read the row first and then ran an
 * `update({ where: { id } })`; because `id` is immutable that predicate still
 * matched after the winner committed, so both requests could consume the same
 * token (TOCTOU).
 *
 * `auth_tokens` is the table name mapped by `@@map("auth_tokens")` on the
 * Prisma `AuthToken` model. The column names are quoted because the schema uses
 * camelCase fields, which PostgreSQL would otherwise fold to lowercase.
 *
 * Values are bound as parameters via the tagged-template form of `$queryRaw`;
 * they are never interpolated into the SQL string.
 */
export async function verifyAuthToken(
  userId: string,
  type: AuthTokenType,
  rawToken: string
): Promise<{ valid: boolean; tokenId?: string }> {
  const tokenHash = hashToken(rawToken);

  const rows = await getPrisma().$queryRaw<{ id: string }[]>`
    UPDATE "auth_tokens"
       SET "usedAt" = now()
     WHERE "userId" = ${userId}
       AND "type" = ${type}::"AuthTokenType"
       AND "tokenHash" = ${tokenHash}
       AND "usedAt" IS NULL
       AND "expiresAt" > now()
    RETURNING "id"
  `;

  const consumed = rows[0];

  if (!consumed) {
    return { valid: false };
  }

  return { valid: true, tokenId: consumed.id };
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