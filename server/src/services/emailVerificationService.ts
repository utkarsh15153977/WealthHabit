import { Prisma } from '@prisma/client';
import { env } from '../config/index.js';
import { prisma } from '../config/prisma.js';
import { AuditActions, recordAuditEvent } from './auditLogService.js';
import {
  consumeAuthTokenByTokenHash,
  createEmailVerificationToken,
  findAuthTokenByHash,
  revokeUserAuthTokens,
} from './authTokenService.js';
import { sendVerificationEmail } from './emailService.js';
import { AppError } from '../utils/errors.js';
import { AuthErrorCodes } from '../types/auth.js';
import { logger } from '../utils/logger.js';
import { AuthTokenType } from '@prisma/client';

/**
 * Deliberately identical for every rejection. A caller that presented an
 * unknown token, an expired token, an already-consumed token, another user's
 * token or a token of the wrong type learns nothing about which case applied,
 * so the token endpoint cannot be used to probe the token space.
 */
const INVALID_LINK_MESSAGE = 'This verification link is invalid or has expired.';

const INVALID_LINK_ERROR_CODE = AuthErrorCodes.EMAIL_VERIFICATION_INVALID;

/**
 * The resend response. One string for an unverified account, an already
 * verified account, a suspended account and an address that does not exist at
 * all, so the endpoint never becomes an account-existence oracle.
 */
const RESEND_GENERIC_MESSAGE =
  'If your account requires verification, a verification email has been sent.';

const TRANSACTION_TIMEOUT_MS = 15_000;

export type EmailVerificationRejectionReason =
  | 'expired'
  | 'already_used'
  | 'wrong_type'
  | 'unknown_token';

export type EmailVerificationResult =
  | { verified: true; userId: string; alreadyVerified: boolean }
  | { verified: false; reason: EmailVerificationRejectionReason };

export type ResendOutcome =
  | { sent: true }
  | { sent: false; reason: 'not_found' | 'already_verified' | 'cooldown' | 'delivery_failed' };

/**
 * Serializes verification issuance for one account.
 *
 * Two concurrent resends would otherwise both observe "no recent token" and
 * both mint a live token, leaving an account with several usable links and
 * making the cooldown unenforceable. Taking a row lock on `users` first means
 * the second transaction re-reads the freshly inserted token and is refused by
 * the cooldown. The lock is the same `SELECT … FOR UPDATE` idiom already used
 * by `adminUserService`, and only ever precedes inserts into `auth_tokens` /
 * `audit_logs`, so it introduces no lock-ordering cycle.
 */
async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
}

function resendCooldownSince(now: Date): Date | null {
  const cooldownSeconds = env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS;
  if (cooldownSeconds <= 0) {
    return null;
  }
  return new Date(now.getTime() - cooldownSeconds * 1000);
}

interface IssueParams {
  userId: string;
  isResend: boolean;
  firstName: string;
  to: string;
}

/**
 * Mints a fresh verification token and delivers the email.
 *
 * Ordering: the token insert and its audit row commit together; the email is
 * sent afterwards, outside the transaction. Sending inside the transaction
 * would hold the user row lock across a network round trip for every
 * registration. The accepted consequence is that a provider failure leaves a
 * committed-but-undelivered token: it is inert (single use, expiring) and the
 * account can retry through the resend endpoint.
 */
async function issue(params: IssueParams): Promise<ResendOutcome> {
  const { userId, isResend, firstName, to } = params;
  const ttlMinutes = env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES;

  const issued = await prisma.$transaction(
    async (tx) => {
      await lockUserRow(tx, userId);

      if (isResend) {
        const cooldownSince = resendCooldownSince(new Date());

        if (cooldownSince) {
          const recent = await tx.authToken.findFirst({
            where: {
              userId,
              type: AuthTokenType.EMAIL_VERIFICATION,
              createdAt: { gt: cooldownSince },
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          });

          if (recent) {
            return null;
          }
        }
      }

      // A resend supersedes every outstanding link so an account never
      // accumulates several simultaneously valid ones; registration has nothing
      // to supersede.
      const supersededLinks = isResend
        ? await revokeUserAuthTokens(userId, AuthTokenType.EMAIL_VERIFICATION, tx)
        : 0;

      const token = await createEmailVerificationToken(userId, ttlMinutes, tx);

      await recordAuditEvent(
        {
          actorUserId: userId,
          action: isResend
            ? AuditActions.EMAIL_VERIFICATION_RESENT
            : AuditActions.EMAIL_VERIFICATION_SENT,
          entityType: 'User',
          entityId: userId,
          // Key names avoid the audit read-sanitizer's sensitive-key pattern
          // (`…token…`) and never carry the raw token or the link.
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

  const delivery = await sendVerificationEmail({
    to,
    firstName,
    rawToken: issued.rawToken,
    expiresAt: issued.expiresAt,
  });

  if (!delivery.delivered) {
    logger.error('verification email not delivered', { userId, transport: delivery.transport });
    return { sent: false, reason: 'delivery_failed' };
  }

  return { sent: true };
}

/**
 * Registration entry point: the account is created unverified
 * (`emailVerifiedAt` is null) and its first link is issued here.
 */
export async function issueInitialEmailVerification(params: {
  userId: string;
  firstName: string;
  to: string;
}): Promise<ResendOutcome> {
  return issue({ userId: params.userId, isResend: false, firstName: params.firstName, to: params.to });
}

/**
 * Resend entry point.
 *
 * Never throws for an unknown, already verified or cooling-down address: the
 * caller answers with the same generic success in every case.
 */
export async function resendEmailVerification(email: string): Promise<ResendOutcome> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, firstName: true, emailVerifiedAt: true },
  });

  if (!user) {
    return { sent: false, reason: 'not_found' };
  }

  if (user.emailVerifiedAt !== null) {
    return { sent: false, reason: 'already_verified' };
  }

  return issue({ userId: user.id, isResend: true, firstName: user.firstName, to: user.email });
}

/**
 * Records a rejected attempt for the audit log. Only attempts that name a real
 * token row produce a row.
 */
async function recordRejection(
  reason: EmailVerificationRejectionReason,
  userId: string | null
): Promise<void> {
  // An unknown token writes nothing: an unauthenticated caller must not be able
  // to turn this endpoint into an unbounded audit-log write amplifier by
  // guessing random values.
  if (reason === 'unknown_token' || userId === null) {
    return;
  }

  try {
    await recordAuditEvent({
      // No authenticated actor: the caller only ever presented a token.
      actorUserId: null,
      action: AuditActions.EMAIL_VERIFICATION_FAILED,
      entityType: 'User',
      entityId: userId,
      metadata: { targetUserId: userId, reason },
    });
  } catch (error) {
    logger.error('failed to record email verification rejection', {
      userId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

/**
 * Atomically consumes the presented token and, in the same transaction, marks
 * the address verified and records the audit event.
 *
 * Consumption is the deciding step: `consumeAuthTokenByTokenHash` runs one
 * conditional `UPDATE … RETURNING` whose predicate includes
 * `usedAt IS NULL AND expiresAt > now()`, so concurrent callers presenting the
 * same token produce exactly one winner no matter how they interleave. Only the
 * winner learns the owner id, and only the winner goes on to write
 * `emailVerifiedAt` — which is what keeps "token consumed" and "email
 * verified" from ever disagreeing, even if the request dies between them.
 */
export async function verifyEmailWithToken(rawToken: string): Promise<EmailVerificationResult> {
  const outcome = await prisma.$transaction(
    async (tx) => {
      const consumption = await consumeAuthTokenByTokenHash(
        AuthTokenType.EMAIL_VERIFICATION,
        rawToken,
        tx
      );

      if (!consumption.valid || !consumption.userId) {
        return null;
      }

      // `emailVerifiedAt IS NULL` makes the write a compare-and-set, so a
      // verification that is already verified is never re-stamped with a later
      // timestamp (idempotent replay).
      const stamped = await tx.user.updateMany({
        where: { id: consumption.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });

      if (stamped.count === 1) {
        await recordAuditEvent(
          {
            actorUserId: consumption.userId,
            action: AuditActions.EMAIL_VERIFIED,
            entityType: 'User',
            entityId: consumption.userId,
            metadata: { targetUserId: consumption.userId },
          },
          tx
        );
      }

      return { userId: consumption.userId, alreadyVerified: stamped.count === 0 };
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );

  if (outcome) {
    return { verified: true, userId: outcome.userId, alreadyVerified: outcome.alreadyVerified };
  }

  const { reason, userId } = await classifyRejection(rawToken);
  await recordRejection(reason, userId);

  return { verified: false, reason };
}

/**
 * Read-only diagnosis of why consumption matched nothing. Runs only after the
 * atomic attempt has already failed, so it cannot affect the outcome. Returns
 * the owning user id alongside the reason so the audit write does not have to
 * look the token up a second time.
 */
async function classifyRejection(
  rawToken: string
): Promise<{ reason: EmailVerificationRejectionReason; userId: string | null }> {
  const token = await findAuthTokenByHash(rawToken);

  if (!token) {
    return { reason: 'unknown_token', userId: null };
  }

  if (token.type !== AuthTokenType.EMAIL_VERIFICATION) {
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
 * Throws the single generic rejection the controller turns into an HTTP
 * response. Split out so the classification detail stays server-side.
 */
export function invalidEmailVerificationLink(): AppError {
  return AppError.badRequest(INVALID_LINK_MESSAGE, undefined, INVALID_LINK_ERROR_CODE);
}

export const emailVerificationMessages = {
  invalidLink: INVALID_LINK_MESSAGE,
  resend: RESEND_GENERIC_MESSAGE,
  verified: 'Email verified successfully.',
} as const;

export const emailVerificationService = {
  issueInitialEmailVerification,
  resendEmailVerification,
  verifyEmailWithToken,
  invalidEmailVerificationLink,
};