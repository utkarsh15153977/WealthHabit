import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  AdminChallengeDetail,
  AdminChallengeListParams,
  AdminChallengeListResponse,
} from '../types/adminChallenges';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

function buildListParams(
  params: AdminChallengeListParams
): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (params.page !== undefined) query.page = params.page;
  if (params.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params.search) query.search = params.search;
  if (params.type) query.type = params.type;
  if (params.status) query.status = params.status;
  if (params.active !== undefined) query.active = String(params.active);
  if (params.dateFrom) query.dateFrom = params.dateFrom;
  if (params.dateTo) query.dateTo = params.dateTo;
  return query;
}

export async function listAdminChallenges(
  params: AdminChallengeListParams = {}
): Promise<AdminChallengeListResponse> {
  const response = await api.get<ApiResponse<AdminChallengeListResponse>>(
    '/admin/challenges',
    { params: buildListParams(params) }
  );
  return unwrapData(response.data);
}

export async function getAdminChallenge(
  id: string
): Promise<{ challenge: AdminChallengeDetail }> {
  const response = await api.get<
    ApiResponse<{ challenge: AdminChallengeDetail }>
  >(`/admin/challenges/${id}`);
  return unwrapData(response.data);
}

export const adminChallengesApi = {
  listAdminChallenges,
  getAdminChallenge,
};
