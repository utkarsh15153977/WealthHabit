import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export const AuditActions = {
  ADMIN_USER_STATUS_CHANGED: 'ADMIN_USER_STATUS_CHANGED',
  ADMIN_USER_ROLE_CHANGED: 'ADMIN_USER_ROLE_CHANGED',
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
 * Minimal audit-log writer used by admin user management.
 * The full audit-log querying/UI surface remains Phase 5F-4.
 * Never pass credentials, tokens or secrets as metadata.
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
