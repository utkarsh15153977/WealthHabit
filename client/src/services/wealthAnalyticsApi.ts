import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  AnalyticsRangeParams,
  AnalyticsSummary,
  AssetAnalytics,
  CashFlowAnalytics,
  LiabilityAnalytics,
  NetWorthAnalytics,
} from '../types/wealthAnalytics';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

function rangeQuery(params: AnalyticsRangeParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.dateFrom) query.dateFrom = params.dateFrom;
  if (params.dateTo) query.dateTo = params.dateTo;
  return query;
}

/** Current position + savings goal analytics (range independent). */
export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  const response = await api.get<ApiResponse<AnalyticsSummary>>(
    '/wealth-analytics/summary'
  );
  return unwrapData(response.data);
}

/** Stored WealthSnapshot history plus Net Worth Change for the range. */
export async function getNetWorthAnalytics(
  params: AnalyticsRangeParams = {}
): Promise<NetWorthAnalytics> {
  const query = rangeQuery(params);
  const response = await api.get<ApiResponse<NetWorthAnalytics>>(
    '/wealth-analytics/net-worth',
    {
      params: Object.keys(query).length > 0 ? query : undefined,
    }
  );
  return unwrapData(response.data);
}

export async function getAssetAnalytics(): Promise<AssetAnalytics> {
  const response = await api.get<ApiResponse<AssetAnalytics>>(
    '/wealth-analytics/assets'
  );
  return unwrapData(response.data);
}

export async function getLiabilityAnalytics(): Promise<LiabilityAnalytics> {
  const response = await api.get<ApiResponse<LiabilityAnalytics>>(
    '/wealth-analytics/liabilities'
  );
  return unwrapData(response.data);
}

export async function getCashFlowAnalytics(
  params: AnalyticsRangeParams = {}
): Promise<CashFlowAnalytics> {
  const query = rangeQuery(params);
  const response = await api.get<ApiResponse<CashFlowAnalytics>>(
    '/wealth-analytics/cash-flow',
    {
      params: Object.keys(query).length > 0 ? query : undefined,
    }
  );
  return unwrapData(response.data);
}

/**
 * Every analytics call is a read-only GET: there is no create, update or
 * delete helper here because analytics never write to a financial record.
 */
export const wealthAnalyticsApi = {
  getAnalyticsSummary,
  getNetWorthAnalytics,
  getAssetAnalytics,
  getLiabilityAnalytics,
  getCashFlowAnalytics,
};
