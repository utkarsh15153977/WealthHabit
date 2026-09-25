import api from './api';
import type { ApiResponse } from '../types/api';
import type { DashboardSummaryData, DashboardSummaryParams } from '../types/dashboard';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

function buildParams(params: DashboardSummaryParams): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (params.month) query.month = params.month;
  if (params.trendMonths !== undefined) query.trendMonths = params.trendMonths;
  if (params.recentLimit !== undefined) query.recentLimit = params.recentLimit;
  if (params.categoryLimit !== undefined) query.categoryLimit = params.categoryLimit;
  return query;
}

export async function getDashboardSummary(
  params: DashboardSummaryParams = {}
): Promise<DashboardSummaryData> {
  const response = await api.get<ApiResponse<DashboardSummaryData>>('/dashboard/summary', {
    params: buildParams(params),
  });
  return unwrapData(response.data);
}

export const dashboardApi = {
  getDashboardSummary,
};
