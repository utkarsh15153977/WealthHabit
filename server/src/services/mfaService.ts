import { randomBytes } from 'crypto';
import { AccountStatus, AuthTokenType, Prisma } from '@prisma/client';
import { env } from '../config/index.js';
import { prisma } from '../config/prisma.js';
import { decryptTOTPSecret, encryptTOTPSecret } from '../crypto/aesGcm.js';
import { authService } from './authService.js';
import { AuditActions, recordAuditEvent } from './auditLogService.js';
import {
  consumeAuthTokenByTokenHash,
  createMfaChallengeToken,
  findAuthTokenByHash,
  hashAuthToken,
  revokeUserAuthTokens,
} from './authTokenService.js';
import { revokeAllUserSessionsExcept } from './prismaAuthService.js';
import { buildOtpauthUri, generateTotpSecret, verifyTotpCode } from './totp.js';
import { AuthErrorCodes } from '../types/auth.js';
import type { AuthenticatedUser } from '../types/auth.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const TRANSACTION_TIMEOUT_MS = 15_000;

/**
 * Dozens of codes are is worth over twice the entropy of the six decimal digits
 * of a TOTP code, so brute-forcing a stored recovery code directly is pointless —
 * but they are still one-shot, high-value credentials printed on screen, so the
 * visible alphabet drops the characters people reliably confuse (I/L/1 and O/0).
 * 32 symbols = 60 bits per code; a fresh page replaces all ten.
 */
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_GROUP_CHARS = 4;
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Deliberately identical for every rejection the 2FA login endpoints produce:
 * an unknown challenge token, an expired one, an already-used one, a token of
 * the wrong type, a TOTP code that did not verify, a recovery code that was
 * wrong or already spent, and every request that lost a race against another
 * concurrent one. A caller that can distinguish these cases could probe the
 * challenge space, confirm a guessed code, or mount a targeted audit-log /
 * rate-limit nuisance scheme.
 */
const INVALID_CHALLENGE_MESSAGE = 'This two-factor verification is invalid or has expired.';

const SETUP_REQUIRED_MESSAGE = 'Start two-factor setup before confirming it.';
const SETUP_EXPIRED_MESSAGE = 'This two-factor setup has expired. Start again.';
const ALREADY_ENABLED_MESSAGE = 'Two-factor authentication is already enabled.';
const NOT_ENABLED_MESSAGE = 'Two-factor authentication is not enabled.';
const PASSWORD_UNVERIFIED_MESSAGE = 'The password provided could not be verified.';
const CODE_INVALID_MESSAGE = 'The authenticator code provided is incorrect.';
const DISABLED_MESSAGE = 'Two-factor authentication has been disabled.';

function isEligible(status: AccountStatus): boolean {
  return status === AccountStatus.ACTIVE;
}

/**
 * Serializes enrollment/confirmation/removal for one account. All the
 * mutations below read-and-then-write `user_mfa`; without a row lock a stale
 * `startMfaSetup` racing a fresh `enableMfa` could, for example, silently
 * reset `enabledAt` back to NULL. Same `SELECT … FOR UPDATE` idiom as
 * `emailVerificationService` and `passwordResetService`, and it only ever
 * precedes writes committed on the same transaction, so it introduces no
 * lock-ordering cycle.
 */
async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
}

function splitRecoveryGroups(compact: string): string {
  const groups: string[] = [];
  for (let i = 0; i < compact.length; i += RECOVERY_CODE_GROUP_CHARS) {
    groups.push(compact.slice(i, i + RECOVERY_CODE_GROUP_CHARS));
  }
  return groups.join('-');
}

/**
 * Canonicalizes user input: case, whitespace and punctuation are removed, the
 * remainder is uppercased and re-grouped in the one true shape. "abcd efgh
 * ijkl", "ABCD-EFGH-IJKL" and "ABCDEFGHIJKL" therefore all compare equal, and
 * their stored hash is always of the grouped form.
 */
export function normalizeRecoveryCode(input: string): string {
  return splitRecoveryGroups(input.toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

/** Each code is 12 symbols from a 32-symbol alphabet, displayed as XXXX-XXXX-XXXX. */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = randomBytes(RECOVERY_CODE_GROUP_CHARS * 3);
    let compact = '';
    for (const byte of bytes) {
      compact += RECOVERY_CODE_ALPHABET[byte & 0x1f];
    }
    codes.push(splitRecoveryGroups(compact));
  }
  return codes;
}

/**
 * Recovery codes are stored as SHA-256 of the canonical grouped form — the
 * same one-way convention as the single-use auth tokens. A leaked column dump
 * therefore yields no usable codes.
 */
export function hashRecoveryCode(canonicalCode: string): string {
  return hashAuthToken(canonicalCode);
}

/**
 * Thrown *inside* the success transaction to signal that someone else
 * consumed the challenge (or the account's 2FA state changed) between the
 * cheap pre-checks and the commit, so nothing is written and the response is
 * the same generic rejection. It is caught at the transaction boundary only.
 */
class MfaChallengeLostError extends Error {}

const mfaChallengeLost = new MfaChallengeLostError('mfa challenge lost');

function isMfaChallengeLost(error: unknown): boolean {
  return error instanceof MfaChallengeLostError;
}

export type MfaChallengeRejectionReason =
  | 'unknown_token'
  | 'wrong_type'
  | 'already_used'
  | 'expired'
  | 'not_enabled'
  | 'invalid_code'
  | 'lost';

export type MfaLoginOutcome =
  | {
      signedIn: true;
      user: AuthenticatedUser;
      accessToken: string;
      refreshToken: string;
    }
  | { signedIn: false; reason: MfaChallengeRejectionReason };

interface MfaLoginSuccess {
  signedIn: true;
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
}

type MfaLoginSuccessWithInvalidations = MfaLoginSuccess & { invalidatedChallenges: number };

function challengeState(
  token: {
    id: string;
    userId: string;
    type: AuthTokenType;
    usedAt: Date | null;
    expiresAt: Date;
  } | null
): { valid: false; reason: 'unknown_token' | 'wrong_type' | 'already_used' | 'expired' } | { valid: true; userId: string } {
  if (!token) {
    return { valid: false, reason: 'unknown_token' };
  }
  if (token.type !== AuthTokenType.MFA_CHALLENGE) {
    return { valid: false, reason: 'wrong_type' };
  }
  if (token.usedAt !== null) {
    return { valid: false, reason: 'already_used' };
  }
  if (token.expiresAt.getTime() <= Date.now()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, userId: token.userId };
}

async function loadChallengeOwner(
  challengeToken: string
): Promise<{ valid: false; reason: MfaChallengeRejectionReason } | { valid: true; userId: string }> {
  const token = await findAuthTokenByHash(challengeToken);
  return challengeState(token);
}

async function recordMfaLoginFailure(userId: string, reason: MfaChallengeRejectionReason): Promise<void> {
  try {
    await recordAuditEvent({
      // Not the account itself: the caller presented only a challenge token.
      actorUserId: null,
      action: AuditActions.MFA_LOGIN_FAILED,
      entityType: 'User',
      entityId: userId,
      metadata: { targetUserId: userId, reason },
    });
  } catch (error) {
    logger.error('failed to record mfa login rejection', {
      userId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

/**
 * The single generic rejection the 2FA controllers turn into an HTTP response,
 * so classification detail never reaches the caller.
 */
export function invalidMfaChallenge(): AppError {
  return AppError.badRequest(INVALID_CHALLENGE_MESSAGE, undefined, AuthErrorCodes.MFA_CHALLENGE_INVALID);
}

export interface TwoFactorState {
  enabled: boolean;
  pending: boolean;
}

/**
 * Read-only state used by the login handler (does this account need a
 * challenge?) and the client (what does the Security card show?). `pending`
 * means a `user_mfa` row exists whose confirmation is still outstanding.
 */
export async function getTwoFactorState(userId: string): Promise<TwoFactorState> {
  const mfa = await prisma.userMfa.findUnique({
    where: { userId },
    select: { enabledAt: true },
  });
  const enabled = mfa?.enabledAt != null;
  return { enabled, pending: mfa != null && !enabled };
}

export interface MfaSetupResult {
  secret: string;
  otpauthUri: string;
  expiresAt: Date;
}

/**
 * Stage one of enrollment: re-authenticate with the password, generate the
 * secret and persist it in encrypted, disabled ("pending") form.
 *
 * An existing pending row is simply refreshed (new secret, fresh clock), so a
 * user who closed the 2FA screen mid-enrollment can start over without a
 * partial row lingering. A completed enrollment is never overwritten: that
 * would downgrade an enabled account's secret without confirmation.
 *
 * The Argon2 password check runs outside the transaction so the user row lock
 * is never held across the deliberately expensive derivation.
 */
export async function startMfaSetup(input: { userId: string; currentPassword: string }): Promise<MfaSetupResult> {
  const account = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, passwordHash: true, status: true },
  });

  if (!account) {
    throw AppError.notFound('User not found', AuthErrorCodes.UNAUTHORIZED);
  }
  if (!isEligible(account.status)) {
    throw AppError.forbidden('Account suspended', AuthErrorCodes.ACCOUNT_SUSPENDED);
  }
  const passwordValid = await authService.verifyPassword(account.passwordHash, input.currentPassword);
  if (!passwordValid) {
    throw AppError.badRequest(PASSWORD_UNVERIFIED_MESSAGE, undefined, AuthErrorCodes.PASSWORD_UNVERIFIED);
  }

  const secret = generateTotpSecret();
  const secretEncrypted = encryptTOTPSecret(secret);
  const setupStartedAt = new Date();
  const expiresAt = new Date(setupStartedAt.getTime() + env.MFA_SETUP_TTL_MINUTES * 60 * 1000);

  await prisma.$transaction(
    async (tx) => {
      await lockUserRow(tx, account.id);

      const current = await tx.userMfa.findUnique({ where: { userId: account.id } });
      if (current?.enabledAt) {
        throw AppError.conflict(ALREADY_ENABLED_MESSAGE, AuthErrorCodes.MFA_ALREADY_ENABLED);
      }

      await tx.userMfa.upsert({
        where: { userId: account.id },
        create: {
          userId: account.id,
          secretEncrypted,
          setupStartedAt,
        },
        update: {
          secretEncrypted,
          setupStartedAt,
          enabledAt: null,
        },
      });

      await recordAuditEvent(
        {
          actorUserId: account.id,
          action: AuditActions.MFA_SETUP_STARTED,
          entityType: 'User',
          entityId: account.id,
          // Never the secret or the URI; the metadata admin read would drop a
          // key matching "secret|token|…" anyway, and the secret must not enter
          // the audit trail at any level.
          metadata: {
            targetUserId: account.id,
            expiresAt: expiresAt.toISOString(),
            ttlMinutes: env.MFA_SETUP_TTL_MINUTES,
          },
        },
        tx
      );
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );

  return {
    secret,
    otpauthUri: buildOtpauthUri(account.email, env.MFA_ISSUER, secret),
    expiresAt,
  };
}

export interface MfaEnableResult {
  recoveryCodes: string[];
  revokedSessions: number;
}

/**
 * Stage two of enrollment: confirm the pending secret with a TOTP code, flip
 * the flag, mint the recovery page, and tighten access.
 *
 * Everything — flag flip, recovery-code write, session revocation and audit —
 * commits in one transaction, serialized on the user row lock. Two concurrent
 * confirms therefore produce exactly one winner; the loser observes the fresh
 * `enabledAt` under the lock and gets the generic already-enabled rejection
 * with its (differently generated) recovery page discarded.
 *
 * The TOTP code is verified under the lock against the *current* secret, so a
 * stale setup started just before the TTL expires cannot confirm a rotated
 * secret.
 */
export async function enableMfa(input: {
  userId: string;
  code: string;
  keepSessionId: string | null;
}): Promise<MfaEnableResult> {
  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodeHashes = recoveryCodes.map(hashRecoveryCode);

  const outcome = await prisma.$transaction(
    async (tx) => {
      await lockUserRow(tx, input.userId);

      const account = await tx.user.findUnique({
        where: { id: input.userId },
        include: { mfa: true },
      });

      if (!account || !isEligible(account.status)) {
        throw AppError.forbidden('Account suspended', AuthErrorCodes.ACCOUNT_SUSPENDED);
      }
      if (!account.mfa) {
        throw AppError.badRequest(SETUP_REQUIRED_MESSAGE, undefined, AuthErrorCodes.MFA_SETUP_REQUIRED);
      }
      if (account.mfa.enabledAt) {
        throw AppError.badRequest(ALREADY_ENABLED_MESSAGE, undefined, AuthErrorCodes.MFA_ALREADY_ENABLED);
      }
      if (!account.mfa.setupStartedAt) {
        throw AppError.badRequest(SETUP_REQUIRED_MESSAGE, undefined, AuthErrorCodes.MFA_SETUP_REQUIRED);
      }
      if (account.mfa.setupStartedAt.getTime() + env.MFA_SETUP_TTL_MINUTES * 60 * 1000 <= Date.now()) {
        throw AppError.badRequest(SETUP_EXPIRED_MESSAGE, undefined, AuthErrorCodes.MFA_SETUP_EXPIRED);
      }

      const secret = decryptTOTPSecret(account.mfa.secretEncrypted);
      if (!verifyTotpCode(input.code, secret)) {
        throw AppError.badRequest(CODE_INVALID_MESSAGE, undefined, AuthErrorCodes.MFA_CODE_INVALID);
      }

      await tx.userMfa.update({
        where: { userId: input.userId },
        data: { enabledAt: new Date() },
      });

      await tx.recoveryCode.deleteMany({ where: { userId: input.userId } });
      await tx.recoveryCode.createMany({
        data: recoveryCodeHashes.map((codeHash) => ({ userId: input.userId, codeHash })),
      });

      const revokedSessions = await revokeAllUserSessionsExcept(
        input.userId,
        input.keepSessionId ?? '',
        tx
      );

      const invalidatedChallenges = await revokeUserAuthTokens(input.userId, AuthTokenType.MFA_CHALLENGE, tx);

      await recordAuditEvent(
        {
          actorUserId: input.userId,
          action: AuditActions.MFA_ENABLED,
          entityType: 'User',
          entityId: input.userId,
          metadata: {
            targetUserId: input.userId,
            recoveryCodeCount: recoveryCodes.length,
            revokedSessions,
            invalidatedChallenges,
          },
        },
        tx
      );

      return { revokedSessions };
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );

  return { recoveryCodes, revokedSessions: outcome.revokedSessions };
}

export interface MfaChallengeIssuance {
  challengeToken: string;
  expiresInSeconds: number;
}

/**
 * The password half of a 2FA login succeeded; the account needs a second
 * factor. Mints a short-lived, single-use challenge token and loudly revokes
 * every earlier outstanding challenge for the same account, so an old
 * challenge found in a request log or captured from a previous attempt cannot
 * be replayed later. Serialized on the user row lock so two concurrent logins
 * cannot both survive each other's revocation.
 *
 * No session exists yet; nothing is set on the cookie. The raw token is
 * returned to this caller only.
 */
export async function createLoginChallenge(userId: string): Promise<MfaChallengeIssuance> {
  const ttlMinutes = env.MFA_CHALLENGE_TTL_MINUTES;

  const issued = await prisma.$transaction(
    async (tx) => {
      await lockUserRow(tx, userId);

      const invalidatedChallenges = await revokeUserAuthTokens(userId, AuthTokenType.MFA_CHALLENGE, tx);

      const token = await createMfaChallengeToken(userId, ttlMinutes, tx);

      await recordAuditEvent(
        {
          actorUserId: userId,
          action: AuditActions.MFA_LOGIN_CHALLENGE_CREATED,
          entityType: 'User',
          entityId: userId,
          metadata: {
            targetUserId: userId,
            ttlMinutes,
            expiresAt: token.expiresAt.toISOString(),
            invalidatedChallenges,
          },
        },
        tx
      );

      return token;
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );

  return { challengeToken: issued.rawToken, expiresInSeconds: ttlMinutes * 60 };
}

/**
 * A successful second factor plus an unconsumed challenge token becomes a
 * full login, atomically: consume the challenge, re-check the account, create
 * the session, update the last login time, revoke any leftover challenges,
 * and audit. Anyone who loses the challenge consumption race gets a generic
 * rejection and no row is written.
 */
async function completeMfaLogin(
  tx: Prisma.TransactionClient,
  challengeToken: string
): Promise<MfaLoginSuccessWithInvalidations> {
  const consumption = await consumeAuthTokenByTokenHash(AuthTokenType.MFA_CHALLENGE, challengeToken, tx);

  if (!consumption.valid || !consumption.userId) {
    throw mfaChallengeLost;
  }

  const account = await tx.user.findUnique({
    where: { id: consumption.userId },
    include: { mfa: true },
  });

  if (!account || !isEligible(account.status) || !account.mfa?.enabledAt) {
    throw mfaChallengeLost;
  }

  const refreshToken = authService.generateRefreshToken();
  const refreshTokenHash = authService.hashRefreshToken(refreshToken);
  const expiresAt = authService.calculateRefreshExpiry();

  await tx.session.create({
    data: {
      userId: account.id,
      refreshTokenHash,
      tokenFamilyId: randomBytes(16).toString('hex'),
      expiresAt,
    },
  });

  await tx.user.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date() },
  });

  const invalidatedChallenges = await revokeUserAuthTokens(account.id, AuthTokenType.MFA_CHALLENGE, tx);

  return {
    signedIn: true as const,
    user: authService.toAuthenticatedUser(account),
    accessToken: authService.generateAccessToken({ id: account.id, role: account.role }),
    refreshToken,
    invalidatedChallenges,
  };
}

/**
 * Answers a 2FA login challenge with a TOTP code.
 *
 * Failures fall into three buckets with deliberately identical outward
 * behaviour. Tokens that match nothing get a generic rejection and no audit
 * row (no oracle). A real challenge whose account's 2FA is no longer enabled,
 * or whose TOTP code did not verify, additionally writes an `MFA_LOGIN_FAILED`
 * event with the classification for operators. Races that lost the challenge
 * consumption write nothing.
 */
export async function verifyMfaLoginChallenge(challengeToken: string, code: string): Promise<MfaLoginOutcome> {
  const owner = await loadChallengeOwner(challengeToken);
  if (!owner.valid) {
    const state = owner as { valid: false; reason: MfaChallengeRejectionReason };
    return { signedIn: false, reason: state.reason };
  }

  const mfa = await prisma.userMfa.findUnique({
    where: { userId: owner.userId },
    select: { enabledAt: true, secretEncrypted: true },
  });

  if (!mfa?.enabledAt) {
    await recordMfaLoginFailure(owner.userId, 'not_enabled');
    return { signedIn: false, reason: 'not_enabled' };
  }

  const secret = decryptTOTPSecret(mfa.secretEncrypted);
  if (!verifyTotpCode(code, secret)) {
    await recordMfaLoginFailure(owner.userId, 'invalid_code');
    return { signedIn: false, reason: 'invalid_code' };
  }

  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        const result = await completeMfaLogin(tx, challengeToken);

        await recordAuditEvent(
          {
            actorUserId: owner.userId,
            action: AuditActions.MFA_LOGIN_SUCCESS,
            entityType: 'User',
            entityId: owner.userId,
            metadata: {
              targetUserId: owner.userId,
              invalidatedChallenges: result.invalidatedChallenges,
            },
          },
          tx
        );

        return { signedIn: true as const, user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken };
      },
      { timeout: TRANSACTION_TIMEOUT_MS }
    );

    return outcome;
  } catch (error) {
    if (isMfaChallengeLost(error)) {
      return { signedIn: false, reason: 'lost' };
    }
    throw error;
  }
}

/**
 * Answers a 2FA login challenge with a recovery code.
 *
 * The recovery code is spent with a conditional `UPDATE` (`usedAt IS NULL`) —
 * the database decides which concurrent user wins, so a single code can ever
 * fund one login. If the code does not match or was already spent, the whole
 * transaction rolls back: the challenge stays unconsumed, so the account can
 * still be reached via a TOTP code or another recovery code.
 */
export async function verifyMfaLoginRecoveryCode(
  challengeToken: string,
  recoveryCode: string
): Promise<MfaLoginOutcome> {
  const owner = await loadChallengeOwner(challengeToken);
  if (!owner.valid) {
    const state = owner as { valid: false; reason: MfaChallengeRejectionReason };
    return { signedIn: false, reason: state.reason };
  }

  const mfa = await prisma.userMfa.findUnique({
    where: { userId: owner.userId },
    select: { enabledAt: true },
  });

  if (!mfa?.enabledAt) {
    await recordMfaLoginFailure(owner.userId, 'not_enabled');
    return { signedIn: false, reason: 'not_enabled' };
  }

  const canonical = normalizeRecoveryCode(recoveryCode);
  const codeHash = hashRecoveryCode(canonical);

  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        const consumption = await consumeAuthTokenByTokenHash(AuthTokenType.MFA_CHALLENGE, challengeToken, tx);

        if (!consumption.valid || !consumption.userId) {
          throw mfaChallengeLost;
        }

        const account = await tx.user.findUnique({
          where: { id: consumption.userId },
          include: { mfa: true },
        });

        if (!account || !isEligible(account.status) || !account.mfa?.enabledAt) {
          throw mfaChallengeLost;
        }

        const spent = await tx.recoveryCode.updateMany({
          where: { userId: consumption.userId, codeHash, usedAt: null },
          data: { usedAt: new Date() },
        });

        if (spent.count !== 1) {
          // Wrong or already-spent code: roll everything back, leaving the
          // challenge usable for a genuine attempt.
          throw mfaChallengeLost;
        }

        const refreshToken = authService.generateRefreshToken();
        const refreshTokenHash = authService.hashRefreshToken(refreshToken);
        const expiresAt = authService.calculateRefreshExpiry();

        await tx.session.create({
          data: {
            userId: account.id,
            refreshTokenHash,
            tokenFamilyId: randomBytes(16).toString('hex'),
            expiresAt,
          },
        });

        await tx.user.update({
          where: { id: account.id },
          data: { lastLoginAt: new Date() },
        });

        await revokeUserAuthTokens(account.id, AuthTokenType.MFA_CHALLENGE, tx);

        await recordAuditEvent(
          {
            actorUserId: account.id,
            action: AuditActions.MFA_RECOVERY_CODE_USED,
            entityType: 'User',
            entityId: account.id,
            metadata: { targetUserId: account.id },
          },
          tx
        );

        return {
          signedIn: true as const,
          user: authService.toAuthenticatedUser(account),
          accessToken: authService.generateAccessToken({ id: account.id, role: account.role }),
          refreshToken,
        };
      },
      { timeout: TRANSACTION_TIMEOUT_MS }
    );

    return outcome;
  } catch (error) {
    if (isMfaChallengeLost(error)) {
      return { signedIn: false, reason: 'lost' };
    }
    throw error;
  }
}

export interface MfaDisableResult {
  revokedSessions: number;
}

/**
 * Removes 2FA: password plus a currently-valid TOTP code, then the flag, the
 * recovery codes, every unaffected session and every outstanding challenge
 * disappear together. The performing session survives.
 */
export async function disableMfa(input: {
  userId: string;
  password: string;
  code: string;
  keepSessionId: string | null;
}): Promise<MfaDisableResult> {
  return prisma.$transaction(
    async (tx) => {
      await lockUserRow(tx, input.userId);

      const account = await tx.user.findUnique({ where: { id: input.userId }, include: { mfa: true } });

      if (!account || !account.mfa?.enabledAt) {
        throw AppError.badRequest(NOT_ENABLED_MESSAGE, undefined, AuthErrorCodes.MFA_NOT_ENABLED);
      }

      const passwordValid = await authService.verifyPassword(account.passwordHash, input.password);
      if (!passwordValid) {
        throw AppError.badRequest(PASSWORD_UNVERIFIED_MESSAGE, undefined, AuthErrorCodes.PASSWORD_UNVERIFIED);
      }

      const secret = decryptTOTPSecret(account.mfa.secretEncrypted);
      if (!verifyTotpCode(input.code, secret)) {
        throw AppError.badRequest(CODE_INVALID_MESSAGE, undefined, AuthErrorCodes.MFA_CODE_INVALID);
      }

      await tx.userMfa.delete({ where: { userId: input.userId } });
      await tx.recoveryCode.deleteMany({ where: { userId: input.userId } });

      const revokedSessions = await revokeAllUserSessionsExcept(input.userId, input.keepSessionId ?? '', tx);
      const invalidatedChallenges = await revokeUserAuthTokens(input.userId, AuthTokenType.MFA_CHALLENGE, tx);

      await recordAuditEvent(
        {
          actorUserId: input.userId,
          action: AuditActions.MFA_DISABLED,
          entityType: 'User',
          entityId: input.userId,
          metadata: {
            targetUserId: input.userId,
            revokedSessions,
            invalidatedChallenges,
          },
        },
        tx
      );

      return { revokedSessions };
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );
}

export interface MfaRegenerateResult {
  recoveryCodes: string[];
  supersededCodes: number;
}

/**
 * Issues a fresh ten-code page and retires every not-yet-used code of the
 * previous page in the same transaction. Used codes keep their `usedAt` (the
 * audit trail must not silently rewrite history).
 */
export async function regenerateRecoveryCodes(input: {
  userId: string;
  password: string;
  code: string;
}): Promise<MfaRegenerateResult> {
  const recoveryCodes = generateRecoveryCodes();

  const outcome = await prisma.$transaction(
    async (tx) => {
      await lockUserRow(tx, input.userId);

      const account = await tx.user.findUnique({ where: { id: input.userId }, include: { mfa: true } });

      if (!account || !account.mfa?.enabledAt) {
        throw AppError.badRequest(NOT_ENABLED_MESSAGE, undefined, AuthErrorCodes.MFA_NOT_ENABLED);
      }

      const passwordValid = await authService.verifyPassword(account.passwordHash, input.password);
      if (!passwordValid) {
        throw AppError.badRequest(PASSWORD_UNVERIFIED_MESSAGE, undefined, AuthErrorCodes.PASSWORD_UNVERIFIED);
      }

      const secret = decryptTOTPSecret(account.mfa.secretEncrypted);
      if (!verifyTotpCode(input.code, secret)) {
        throw AppError.badRequest(CODE_INVALID_MESSAGE, undefined, AuthErrorCodes.MFA_CODE_INVALID);
      }

      const supersededCodes = await tx.recoveryCode.updateMany({
        where: { userId: input.userId, usedAt: null },
        data: { usedAt: new Date() },
      });

      await tx.recoveryCode.createMany({
        data: recoveryCodes.map((code) => ({ userId: input.userId, codeHash: hashRecoveryCode(code) })),
      });

      await recordAuditEvent(
        {
          actorUserId: input.userId,
          action: AuditActions.MFA_RECOVERY_CODES_REGENERATED,
          entityType: 'User',
          entityId: input.userId,
          metadata: {
            targetUserId: input.userId,
            recoveryCodeCount: recoveryCodes.length,
            supersededCodes: supersededCodes.count,
          },
        },
        tx
      );

      return { supersededCodes: supersededCodes.count };
    },
    { timeout: TRANSACTION_TIMEOUT_MS }
  );

  return { recoveryCodes, supersededCodes: outcome.supersededCodes };
}

export const mfaService = {
  getTwoFactorState,
  startMfaSetup,
  enableMfa,
  createLoginChallenge,
  verifyMfaLoginChallenge,
  verifyMfaLoginRecoveryCode,
  disableMfa,
  regenerateRecoveryCodes,
  invalidMfaChallenge,
};

export const mfaMessages = {
  invalidChallenge: INVALID_CHALLENGE_MESSAGE,
  setupRequired: SETUP_REQUIRED_MESSAGE,
  setupExpired: SETUP_EXPIRED_MESSAGE,
  alreadyEnabled: ALREADY_ENABLED_MESSAGE,
  notEnabled: NOT_ENABLED_MESSAGE,
  passwordUnverified: PASSWORD_UNVERIFIED_MESSAGE,
  invalidCode: CODE_INVALID_MESSAGE,
  disabled: DISABLED_MESSAGE,
} as const;

export { RECOVERY_CODE_COUNT, RECOVERY_CODE_ALPHABET, RECOVERY_CODE_GROUP_CHARS };