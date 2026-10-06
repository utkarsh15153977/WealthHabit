import { randomBytes, createHash } from 'crypto';
import { Prisma, PrismaClient, AuthTokenType } from '@prisma/client';
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

/**
 * SHA-256 digest of a raw single-use token, i.e. exactly the value persisted in
 * `auth_tokens.tokenHash`. Exported so read-only lookups by presented token
 * hash the input identically to the atomic consumption path.
 */
export function hashAuthToken(rawToken: string): string {
  return hashToken(rawToken);
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
 * Creates a single-use auth token of `type` with an explicitly supplied lifetime
 * in minutes, used where the TTL is operator-configurable in minutes rather than
 * hours. The raw token is returned to the caller for delivery only; nothing but
 * the hash is written.
 *
 * Pass `client` when the insert must join an open transaction. It is not
 * optional in practice for issuance: inserting an `auth_tokens` row takes a
 * `FOR KEY SHARE` lock on the referenced user row for the foreign-key check,
 * and that lock conflicts with a `FOR UPDATE` already held by the same logical
 * operation on another connection. Writing through a second connection would
 * therefore deadlock against the caller's own transaction until it times out.
 */
export async function createTypedAuthToken(
  userId: string,
  type: AuthTokenType,
  ttlMinutes: number,
  client?: AuthTokenQueryClient
): Promise<{ rawToken: string; tokenHash: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const executor = client ?? getPrisma();

  await executor.authToken.create({
    data: {
      userId,
      tokenHash,
      type,
      expiresAt,
    },
  });

  return { rawToken, tokenHash, expiresAt };
}

/** `EMAIL_VERIFICATION` flavour of {@link createTypedAuthToken}. */
export async function createEmailVerificationToken(
  userId: string,
  ttlMinutes: number,
  client?: AuthTokenQueryClient
): Promise<{ rawToken: string; tokenHash: string; expiresAt: Date }> {
  return createTypedAuthToken(userId, AuthTokenType.EMAIL_VERIFICATION, ttlMinutes, client);
}

/** `PASSWORD_RESET` flavour of {@link createTypedAuthToken}. */
export async function createPasswordResetToken(
  userId: string,
  ttlMinutes: number,
  client?: AuthTokenQueryClient
): Promise<{ rawToken: string; tokenHash: string; expiresAt: Date }> {
  return createTypedAuthToken(userId, AuthTokenType.PASSWORD_RESET, ttlMinutes, client);
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

export type AuthTokenQueryClient = PrismaClient | Prisma.TransactionClient;

/**
 * Owner-agnostic sibling of `verifyAuthToken` for the email-verification flow,
 * where the request presents only the raw token and no user id.
 *
 * The single-statement `UPDATE ... RETURNING` shape is what makes consumption
 * atomic, and that is preserved verbatim: the consumed-state predicate
 * (`"usedAt" IS NULL`) and the expiry predicate live INSIDE the statement, so
 * under READ COMMITTED a losing racer re-evaluates them against the winner's
 * committed tuple, matches zero rows and consumes nothing. The owner is resolved
 * from `RETURNING "userId"` — i.e. only a caller that actually won gets an
 * owner, which is what lets the verification flow mark exactly one user's
 * address as verified without a separate read-then-update window.
 *
 * `client` may be an interactive transaction client, so token consumption,
 * setting `users.emailVerifiedAt` and writing the audit row commit together.
 */
export async function consumeAuthTokenByTokenHash(
  type: AuthTokenType,
  rawToken: string,
  client?: AuthTokenQueryClient
): Promise<{ valid: boolean; tokenId?: string; userId?: string }> {
  const tokenHash = hashToken(rawToken);
  const executor = client ?? getPrisma();

  const rows = await executor.$queryRaw<{ id: string; userId: string }[]>`
    UPDATE "auth_tokens"
       SET "usedAt" = now()
     WHERE "type" = ${type}::"AuthTokenType"
       AND "tokenHash" = ${tokenHash}
       AND "usedAt" IS NULL
       AND "expiresAt" > now()
    RETURNING "id", "userId"
  `;

  const consumed = rows[0];

  if (!consumed) {
    return { valid: false };
  }

  return { valid: true, tokenId: consumed.id, userId: consumed.userId };
}

/**
 * Read-only classification of a presented token, used to explain a rejected
 * verification attempt in the audit log. It never consumes anything and is
 * never on the success path, so it cannot widen the atomic-consumption
 * guarantee of `consumeAuthTokenByTokenHash`.
 *
 * `tokenHash` carries no unique index, so this is a `findFirst`. That is safe:
 * the value is the SHA-256 of 256 bits of `randomBytes`, so a collision is not a
 * practical concern — and even if one existed, this lookup only ever feeds an
 * audit classification, never the consumption decision.
 */
export async function findAuthTokenByHash(
  rawToken: string
): Promise<{ id: string; userId: string; type: AuthTokenType; usedAt: Date | null; expiresAt: Date } | null> {
  const tokenHash = hashToken(rawToken);

  return getPrisma().authToken.findFirst({
    where: { tokenHash },
    select: { id: true, userId: true, type: true, usedAt: true, expiresAt: true },
  });
}

export async function revokeUserAuthTokens(
  userId: string,
  type?: AuthTokenType,
  client?: AuthTokenQueryClient
): Promise<number> {
  const executor = client ?? getPrisma();

  const result = await executor.authToken.updateMany({
    where: {
      userId,
      ...(type ? { type } : {}),
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });

  return result.count;
}

export async function cleanupExpiredAuthTokens(): Promise<number> {
  const result = await getPrisma().authToken.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}