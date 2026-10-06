import { AccountStatus, AuthTokenType, Prisma } from '@prisma/client';
import { env } from '../config/index.js';
import { prisma } from '../config/prisma.js';
import { authService } from './authService.js';
import { AuditActions, recordAuditEvent } from './auditLogService.js';
import {
  consumeAuthTokenByTokenHash,
  createPasswordResetToken,
  findAuthTokenByHash,
  revokeUserAuthTokens,
} from './authTokenService.js';
import { sendPasswordResetEmail } from './emailService.js';
import { revokeAllUserSessions } from './prismaAuthService.js';
import { AuthErrorCodes } from '../types/auth.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const TRANSACTION_TIMEOUT_MS = 15_000;

/**
 * Deliberately identical for every rejection. A caller that presented an
 * unknown token, an expired token, an already-used token, another user's token,
 * a token of the wrong type, or a valid token belonging to an account that is
 * no longer eligible learns nothing about which case applied — otherwise the
 * reset endpoint could be used both to probe the token space and to confirm
 * that a guessed token is genuine.
 */
const INVALID_LINK_MESSAGE = 'This password reset link is invalid or has expired.';

/**
 * The one response for every request shape: unknown address, known address,
 * unverified address, suspended or deactivated account, request suppressed by
 * the cooldown, and delivery failure. Nothing in the status code, body or
 * headers varies by outcome.
 */
const FORGOT_GENERIC_MESSAGE =
  'If an account exists for this email address, a password reset email has been sent.';

const RESET_SUCCESS_MESSAGE = 'Your password has been reset. Please sign in with your new password.';

/**
 * Only ACTIVE accounts may reset. A suspended or deactivated account still gets
 * the generic forgot-password response — this predicate must never change what
 * the caller observes, it only decides whether a link is minted.
 */
function isEligible(status: AccountStatus): boolean {
  return status === AccountStatus.ACTIVE;
}

export type ForgotPasswordOutcome =
  | { sent: true }
  | {
      sent: false;
      reason: 'not_found' | 'account_ineligible' | 'cooldown' | 'delivery_failed';
    };

export type PasswordResetRejectionReason =
  | 'expired'
  | 'already_used'
  | 'wrong_type'
  | 'unknown_token'
  | 'account_ineligible';

export type PasswordResetResult =
  | { reset: true; userId: string }
  | { reset: false; reason: PasswordResetRejectionReason };

/**
 * Serializes reset issuance for one account.
 *
 * Two concurrent requests would otherwise both observe "no recent token" and
 * both mint a live link, leaving the account with several usable reset links
 * and making the cooldown unenforceable — and, worse, several independent paths
 * to take the account over. Taking a row lock on `users` first means the second
 * transaction re-reads the freshly inserted token and is refused by the
 * cooldown. Same `SELECT … FOR UPDATE` idiom as `emailVerificationService`, and
 * it only ever precedes inserts into `auth_tokens` / `audit_logs`, so it
 * introduces no lock-ordering cycle.
 */
async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
}

function requestCooldownSince(now: Date): Date | null {
  const cooldownSeconds = env.PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS;
  if (cooldownSeconds <= 0) {
    return null;
  }
  return new Date(now.getTime() - cooldownSeconds * 1000);
}

/**
 * Mints a reset token and delivers the email.
 *
 * Ordering: the token insert and its audit row commit together; the email is
 * sent afterwards, outside the transaction, so the user row lock is never held
 * across a network round trip. A provider failure therefore leaves a
 * committed-but-undelivered token, which is inert (single use, short-lived,
 * superseded by the next request) and must not change the response.
 */
async function issue(params: { userId: string; firstName: string; to: string }): Promise<ForgotPasswordOutcome> {
  const { userId, firstName, to } = params;
  const ttlMinutes = env.PASSWORD_RESET_TOKEN_TTL_MINUTES;

  const issued = await prisma.$transaction(
    async (tx) => {
      await lockUserRow(tx, userId);

      const cooldownSince = requestCooldownSince(new Date());

      if (cooldownSince) {
        const recent = await tx.authToken.findFirst({
          where: {
            userId,
            type: AuthTokenType.PASSWORD_RESET,
            createdAt: { gt: cooldownSince },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });

        if (recent) {
          return null;
        }
      }

      // Only the newest link stays usable: requesting a new reset must
      // invalidate every outstanding one, so an old link found later in an
      // inbox or a mail archive cannot be replayed.
      const supersededLinks = await revokeUserAuthTokens(userId, AuthTokenType.PASSWORD_RESET, tx);

      const token = await createPasswordResetToken(userId, ttlMinutes, tx);

      await recordAuditEvent(
        {
          actorUserId: userId,
          action: AuditActions.PASSWORD_RESET_REQUESTED,
          entityType: 'User',
          entityId: userId,
          // Key names avoid the audit read-sanitizer's sensitive-key pattern
          // (`…token…`) and carry neither the raw token nor the reset link nor
          // the new password.
          metadata: {
            targetUserId: userId,
            expiresAt: token.expiresAt.toISOString(),
            ttlMinutes,
            supersededLinks,
          },
        },
        tx
      );

      return token;
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );

  if (!issued) {
    return { sent: false, reason: 'cooldown' };
  }

  const delivery = await sendPasswordResetEmail({
    to,
    firstName,
    rawToken: issued.rawToken,
    expiresAt: issued.expiresAt,
  });

  if (!delivery.delivered) {
    logger.error('password reset email not delivered', {
      userId,
      transport: delivery.transport,
    });
    return { sent: false, reason: 'delivery_failed' };
  }

  return { sent: true };
}

/**
 * Forgot-password entry point.
 *
 * Never throws and never reports which account exists: the caller answers with
 * the same generic success in every case, including a transport outage. The
 * outcome is returned only so it can be logged and tested server-side.
 */
export async function requestPasswordReset(email: string): Promise<ForgotPasswordOutcome> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, firstName: true, status: true },
  });

  if (!user) {
    return { sent: false, reason: 'not_found' };
  }

  if (!isEligible(user.status)) {
    return { sent: false, reason: 'account_ineligible' };
  }

  return issue({ userId: user.id, firstName: user.firstName, to: user.email });
}

/**
 * Atomically applies a new password.
 *
 * One transaction performs, in order: consume the presented token, re-check
 * that the account is still eligible, write the new hash, revoke every session,
 * invalidate every other outstanding reset link, and record the audit event.
 * Committing them together is the whole security property — a partially applied
 * reset would leave either a usable reset link after the password changed, or
 * live sessions after it did.
 *
 * Session revocation reuses the existing logout-all mechanism
 * (`revokeAllUserSessions`); `POST /auth/refresh` already refuses a revoked
 * session with `TOKEN_REVOKED`, so every session that cannot refresh is dead.
 * Access JWTs are stateless and short-lived (15m by default) and are not
 * revocable without a token-version column, which this feature deliberately
 * does not add — see docs/architecture.md.
 *
 * The Argon2 hash is computed before the transaction opens. Holding a row lock
 * across a deliberately expensive key derivation would serialise every other
 * operation on this user behind it, and the hash does not depend on any state
 * the transaction reads.
 */
export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string
): Promise<PasswordResetResult> {
  const passwordHash = await authService.hashPassword(newPassword);

  const outcome = await prisma.$transaction(
    async (tx) => {
      const consumption = await consumeAuthTokenByTokenHash(
        AuthTokenType.PASSWORD_RESET,
        rawToken,
        tx
      );

      if (!consumption.valid || !consumption.userId) {
        return null;
      }

      const userId = consumption.userId;

      // Taken after consumption because that is the only point at which the
      // owner is known. Order is auth_tokens -> users, which is the mirror of
      // issuance's users -> auth_tokens(insert); the two transactions touch
      // different auth_tokens rows, so they cannot form a cycle.
      await lockUserRow(tx, userId);

      const account = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true },
      });

      // The token is spent either way: a suspended account must not be able to
      // bank a valid link and use it if it is reinstated. Committing the
      // consumption with the failure audit row is intentional.
      if (!account || !isEligible(account.status)) {
        await recordAuditEvent(
          {
            // No authenticated actor: the caller only ever presented a token.
            actorUserId: null,
            action: AuditActions.PASSWORD_RESET_FAILED,
            entityType: 'User',
            entityId: userId,
            metadata: { targetUserId: userId, reason: 'account_ineligible' },
          },
          tx
        );

        return { reset: false as const, reason: 'account_ineligible' as const };
      }

      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });

      const revokedSessions = await revokeAllUserSessions(userId, tx);

      const invalidatedLinks = await revokeUserAuthTokens(
        userId,
        AuthTokenType.PASSWORD_RESET,
        tx
      );

      await recordAuditEvent(
        {
          actorUserId: userId,
          action: AuditActions.PASSWORD_RESET_COMPLETED,
          entityType: 'User',
          entityId: userId,
          metadata: { targetUserId: userId, revokedSessions, invalidatedLinks },
        },
        tx
      );

      return { reset: true as const, userId, revokedSessions, invalidatedLinks };
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );

  if (outcome) {
    return outcome;
  }

  const { reason, userId } = await classifyRejection(rawToken);
  await recordRejection(reason, userId);

  return { reset: false, reason };
}

/**
 * Read-only diagnosis of why consumption matched nothing. Runs only after the
 * atomic attempt has already failed, so it cannot affect the outcome.
 */
async function classifyRejection(
  rawToken: string
): Promise<{ reason: PasswordResetRejectionReason; userId: string | null }> {
  const token = await findAuthTokenByHash(rawToken);

  if (!token) {
    return { reason: 'unknown_token', userId: null };
  }

  if (token.type !== AuthTokenType.PASSWORD_RESET) {
    return { reason: 'wrong_type', userId: token.userId };
  }

  if (token.usedAt !== null) {
    return { reason: 'already_used', userId: token.userId };
  }

  return {
    reason: token.expiresAt.getTime() <= Date.now() ? 'expired' : 'unknown_token',
    userId: token.userId,
  };
}

/**
 * Records a rejected attempt. Only attempts naming a real, unconsumed reset
 * token of the right type produce a row: an unknown token writes nothing, so an
 * unauthenticated caller cannot turn this endpoint into an unbounded audit-log
 * write amplifier by guessing random values.
 */
async function recordRejection(
  reason: PasswordResetRejectionReason,
  userId: string | null
): Promise<void> {
  if (reason === 'unknown_token' || userId === null) {
    return;
  }

  try {
    await recordAuditEvent({
      actorUserId: null,
      action: AuditActions.PASSWORD_RESET_FAILED,
      entityType: 'User',
      entityId: userId,
      metadata: { targetUserId: userId, reason },
    });
  } catch (error) {
    logger.error('failed to record password reset rejection', {
      userId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

/**
 * Throws the single generic rejection the controller turns into an HTTP
 * response, so the classification detail never reaches the caller.
 */
export function invalidPasswordResetLink(): AppError {
  return AppError.badRequest(INVALID_LINK_MESSAGE, undefined, AuthErrorCodes.PASSWORD_RESET_INVALID);
}

export const passwordResetMessages = {
  forgot: FORGOT_GENERIC_MESSAGE,
  resetSuccess: RESET_SUCCESS_MESSAGE,
  invalidLink: INVALID_LINK_MESSAGE,
} as const;

export const passwordResetService = {
  requestPasswordReset,
  resetPasswordWithToken,
  invalidPasswordResetLink,
};