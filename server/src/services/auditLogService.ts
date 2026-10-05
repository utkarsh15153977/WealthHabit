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
