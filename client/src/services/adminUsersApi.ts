import api from './api';
import type { ApiResponse } from '../types/api';
import type { Role, AccountStatus } from '../types/auth';
import type {
  AdminUserDetailResponse,
  AdminUserListParams,
  AdminUserListResponse,
} from '../types/adminUsers';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

function buildListParams(
  params: AdminUserListParams
): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (params.page !== undefined) query.page = params.page;
  if (params.pageSize !== undefined) query.pageSize = params.pageSize;
  if (params.search) query.search = params.search;
  if (params.role) query.role = params.role;
  if (params.status) query.status = params.status;
  return query;
}

export async function listAdminUsers(
  params: AdminUserListParams = {}
): Promise<AdminUserListResponse> {
  const response = await api.get<ApiResponse<AdminUserListResponse>>(
    '/admin/users',
    { params: buildListParams(params) }
  );
  return unwrapData(response.data);
}

export async function getAdminUser(
  id: string
): Promise<AdminUserDetailResponse> {
  const response = await api.get<ApiResponse<AdminUserDetailResponse>>(
    `/admin/users/${id}`
  );
  return unwrapData(response.data);
}

export async function updateAdminUserStatus(
  id: string,
  status: AccountStatus
): Promise<AdminUserDetailResponse> {
  const response = await api.patch<ApiResponse<AdminUserDetailResponse>>(
    `/admin/users/${id}/status`,
    { status }
  );
  return unwrapData(response.data);
}

export async function updateAdminUserRole(
  id: string,
  role: Role
): Promise<AdminUserDetailResponse> {
  const response = await api.patch<ApiResponse<AdminUserDetailResponse>>(
    `/admin/users/${id}/role`,
    { role }
  );
  return unwrapData(response.data);
}

export const adminUsersApi = {
  listAdminUsers,
  getAdminUser,
  updateAdminUserStatus,
  updateAdminUserRole,
};
