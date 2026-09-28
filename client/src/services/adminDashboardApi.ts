import api from './api';
import type { ApiResponse } from '../types/api';
import type { AdminDashboardData } from '../types/adminDashboard';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getAdminDashboard(): Promise<AdminDashboardData> {
  const response = await api.get<ApiResponse<AdminDashboardData>>('/admin/dashboard');
  return unwrapData(response.data);
}