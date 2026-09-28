/**
 * The known audit action set. Mirrors `AuditActions` in
 * `server/src/services/auditLogService.ts` — the filter options on the
 * audit-log page are derived from this list rather than free text.
 */
export const AUDIT_ACTIONS = [
  'ADMIN_USER_STATUS_CHANGED',
  'ADMIN_USER_ROLE_CHANGED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

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
  metadata: unknown;
  createdAt: string;
}

export interface AdminAuditLogListResponse {
  auditLogs: AdminAuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminAuditLogListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  action?: AuditAction;
  actorUserId?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
}
