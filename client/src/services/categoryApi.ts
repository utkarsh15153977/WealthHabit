import api from './api';
import type { ApiResponse } from '../types/api';
import type { CategoryListParams, CategoryListResponse } from '../types/category';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getCategories(params?: CategoryListParams): Promise<CategoryListResponse> {
  const query: Record<string, string> = {};
  if (params?.type) {
    query.type = params.type;
  }

  const response = await api.get<ApiResponse<CategoryListResponse>>('/categories', {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return unwrapData(response.data);
}

export const categoryApi = {
  getCategories,
};
