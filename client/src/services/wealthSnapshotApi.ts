import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  WealthSnapshotListParams,
  WealthSnapshotListResponse,
  WealthSnapshotResponse,
} from '../types/wealthSnapshot';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getWealthSnapshots(
  params: WealthSnapshotListParams = {}
): Promise<WealthSnapshotListResponse> {
  const query: Record<string, string> = {};
  if (params.page !== undefined) query.page = String(params.page);
  if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);

  const response = await api.get<ApiResponse<WealthSnapshotListResponse>>(
    '/wealth-snapshots',
    {
      params: Object.keys(query).length > 0 ? query : undefined,
    }
  );
  return unwrapData(response.data);
}

/**
 * Captures today's UTC snapshot on the server. The body is intentionally
 * empty: every figure is derived from the caller's own assets/liabilities.
 */
export async function createWealthSnapshot(): Promise<WealthSnapshotResponse> {
  const response = await api.post<ApiResponse<WealthSnapshotResponse>>(
    '/wealth-snapshots',
    {}
  );
  return unwrapData(response.data);
}

export const wealthSnapshotApi = {
  getWealthSnapshots,
  createWealthSnapshot,
};
