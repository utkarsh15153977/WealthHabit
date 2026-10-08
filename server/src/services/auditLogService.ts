import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export const AuditActions = {
  ADMIN_USER_STATUS_CHANGED: 'ADMIN_USER_STATUS_CHANGED',
  ADMIN_USER_ROLE_CHANGED: 'ADMIN_USER_ROLE_CHANGED',
  ADMIN_CHALLENGE_CREATED: 'ADMIN_CHALLENGE_CREATED',
  ADMIN_CHALLENGE_UPDATED: 'ADMIN_CHALLENGE_UPDATED',
  ADMIN_CHALLENGE_DELETED: 'ADMIN_CHALLENGE_DELETED',
  EMAIL_VERIFICATION_SENT: 'EMAIL_VERIFICATION_SENT',
  EMAIL_VERIFICATION_RESENT: 'EMAIL_VERIFICATION_RESENT',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  EMAIL_VERIFICATION_FAILED: 'EMAIL_VERIFICATION_FAILED',
  /**
   * Written only when a reset email was genuinely issued to a real, eligible
   * account. Nothing is written for unknown or ineligible addresses, so the
   * audit trail is itself not an account-existence oracle.
   */
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  /**
   * A presented token matched a real reset token but could not be applied —
   * typically a suspended or deactivated account. Attempts with tokens that
   * match nothing write no audit row, because recording them would build an
   * oracle for token guessing.
   */
  PASSWORD_RESET_FAILED: 'PASSWORD_RESET_FAILED',
  /**
   * A pending enrollment was minted (secret issued, not yet confirmed).
   * Written only for a real, eligible, authenticated account; it carries
   * expiry metadata and never the secret or the otpauth URI.
   */
  MFA_SETUP_STARTED: 'MFA_SETUP_STARTED',
  /**
   * The confirming TOTP code matched and the secret went live. `actorUserId`
   * is the authenticated account owner.
   */
  MFA_ENABLED: 'MFA_ENABLED',
  /**
   * A successful password step produced a short-lived single-use login
   * challenge for an account with 2FA enabled. The two same-shaped events
   * below mark positive and negative outcomes of answering it.
   */
  MFA_LOGIN_CHALLENGE_CREATED: 'MFA_LOGIN_CHALLENGE_CREATED',
  MFA_LOGIN_SUCCESS: 'MFA_LOGIN_SUCCESS',
  MFA_LOGIN_FAILED: 'MFA_LOGIN_FAILED',
  MFA_RECOVERY_CODE_USED: 'MFA_RECOVERY_CODE_USED',
  MFA_RECOVERY_CODES_REGENERATED: 'MFA_RECOVERY_CODES_REGENERATED',
  MFA_DISABLED: 'MFA_DISABLED',
  FINANCIAL_CONNECTION_CREATED: 'FINANCIAL_CONNECTION_CREATED',
  FINANCIAL_CONNECTION_REACTIVATED: 'FINANCIAL_CONNECTION_REACTIVATED',
  FINANCIAL_CONNECTION_DISCONNECTED: 'FINANCIAL_CONNECTION_DISCONNECTED',
  FINANCIAL_SYNC_COMPLETED: 'FINANCIAL_SYNC_COMPLETED',
  FINANCIAL_SYNC_FAILED: 'FINANCIAL_SYNC_FAILED',
  IMPORTED_TRANSACTION_RECATEGORIZED: 'IMPORTED_TRANSACTION_RECATEGORIZED',
  IMPORTED_TRANSACTION_UNLINKED: 'IMPORTED_TRANSACTION_UNLINKED',
  IMPORTED_TRANSACTION_CONVERTED_TO_MANUAL: 'IMPORTED_TRANSACTION_CONVERTED_TO_MANUAL',
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];

export type AuditClient = PrismaClient | Prisma.TransactionClient;

export interface AuditEventInput {
  actorUserId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Minimal audit-log writer used by admin user management, admin
 * challenge administration and the email-verification flow. Reading never
 * writes (no audit-of-audit). Never pass credentials, tokens or secrets as
 * metadata — note that the admin read API additionally drops any metadata key
 * matching `password|secret|token|hash|…`, so such a field would silently
 * vanish from the audit UI.
 */
export async function recordAuditEvent(
  event: AuditEventInput,
  client: AuditClient = prisma
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorUserId: event.actorUserId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      metadata: event.metadata,
    },
  });
}
