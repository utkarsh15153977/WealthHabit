import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  Asset,
  AssetListParams,
  AssetListResponse,
  AssetsLiabilitiesSummary,
  AssetResponse,
  CreateAssetRequest,
  CreateLiabilityRequest,
  Liability,
  LiabilityListParams,
  LiabilityListResponse,
  LiabilityResponse,
  UpdateAssetRequest,
  UpdateLiabilityRequest,
} from '../types/assetLiability';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getAssets(
  params: AssetListParams = {}
): Promise<AssetListResponse> {
  const query: Record<string, string> = {};
  if (params.page !== undefined) query.page = String(params.page);
  if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);
  if (params.type) query.type = params.type;

  const response = await api.get<ApiResponse<AssetListResponse>>('/assets', {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return unwrapData(response.data);
}

export async function getAsset(id: string): Promise<Asset> {
  const response = await api.get<ApiResponse<AssetResponse>>(`/assets/${id}`);
  return unwrapData(response.data).asset;
}

export async function createAsset(data: CreateAssetRequest): Promise<Asset> {
  const response = await api.post<ApiResponse<AssetResponse>>('/assets', data);
  return unwrapData(response.data).asset;
}

export async function updateAsset(
  id: string,
  data: UpdateAssetRequest
): Promise<Asset> {
  const response = await api.patch<ApiResponse<AssetResponse>>(
    `/assets/${id}`,
    data
  );
  return unwrapData(response.data).asset;
}

export async function deleteAsset(id: string): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(
    `/assets/${id}`
  );
  return unwrapData(response.data);
}

export async function getLiabilities(
  params: LiabilityListParams = {}
): Promise<LiabilityListResponse> {
  const query: Record<string, string> = {};
  if (params.page !== undefined) query.page = String(params.page);
  if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);
  if (params.type) query.type = params.type;

  const response = await api.get<ApiResponse<LiabilityListResponse>>(
    '/liabilities',
    {
      params: Object.keys(query).length > 0 ? query : undefined,
    }
  );
  return unwrapData(response.data);
}

export async function getLiability(id: string): Promise<Liability> {
  const response = await api.get<ApiResponse<LiabilityResponse>>(
    `/liabilities/${id}`
  );
  return unwrapData(response.data).liability;
}

export async function createLiability(
  data: CreateLiabilityRequest
): Promise<Liability> {
  const response = await api.post<ApiResponse<LiabilityResponse>>(
    '/liabilities',
    data
  );
  return unwrapData(response.data).liability;
}

export async function updateLiability(
  id: string,
  data: UpdateLiabilityRequest
): Promise<Liability> {
  const response = await api.patch<ApiResponse<LiabilityResponse>>(
    `/liabilities/${id}`,
    data
  );
  return unwrapData(response.data).liability;
}

export async function deleteLiability(
  id: string
): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(
    `/liabilities/${id}`
  );
  return unwrapData(response.data);
}

export async function getAssetsLiabilitiesSummary(): Promise<AssetsLiabilitiesSummary> {
  const response = await api.get<ApiResponse<AssetsLiabilitiesSummary>>(
    '/assets-liabilities/summary'
  );
  return unwrapData(response.data);
}

/**
 * Current Net Worth (Total Assets − Total Liabilities) for the live rows.
 * The summary endpoint already returns it, so this is the same single
 * request under its Phase 5C name — never a second, redundant call.
 */
export async function getNetWorth(): Promise<AssetsLiabilitiesSummary> {
  return getAssetsLiabilitiesSummary();
}

export const assetLiabilityApi = {
  getAssets,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
  getLiabilities,
  getLiability,
  createLiability,
  updateLiability,
  deleteLiability,
  getAssetsLiabilitiesSummary,
  getNetWorth,
};
