import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  AdminAuditLogListParams,
  AdminAuditLogListResponse,
} from '../types/adminAuditLogs';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

function buildListParams(
  params: AdminAuditLogListParams
): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (params.page !== undefined) query.page = params.page;
  if (params.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params.search) query.search = params.search;
  if (params.action) query.action = params.action;
  if (params.actorUserId) query.actorUserId = params.actorUserId;
  if (params.entityId) query.entityId = params.entityId;
  if (params.dateFrom) query.dateFrom = params.dateFrom;
  if (params.dateTo) query.dateTo = params.dateTo;
  return query;
}

export async function listAuditLogs(
  params: AdminAuditLogListParams = {}
): Promise<AdminAuditLogListResponse> {
  const response = await api.get<ApiResponse<AdminAuditLogListResponse>>(
    '/admin/audit-logs',
    { params: buildListParams(params) }
  );
  return unwrapData(response.data);
}

export const adminAuditLogsApi = {
  listAuditLogs,
};
