import type { Prisma } from '@prisma/client';

export interface AdminAuditLogActor {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface AdminAuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: AdminAuditLogActor | null;
  target: AdminAuditLogActor | null;
  metadata: Prisma.JsonValue | null;
  createdAt: string;
}

export interface AdminAuditLogListResult {
  auditLogs: AdminAuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
