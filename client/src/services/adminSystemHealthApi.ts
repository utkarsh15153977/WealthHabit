import api from './api';
import type { ApiResponse } from '../types/api';
import type { SystemHealthData } from '../types/adminSystemHealth';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

/**
 * Light structural guard so an empty or malformed payload becomes a
 * normal error state instead of a render crash. Only the documented
 * sections are required — no extra fields are ever read.
 */
function unwrapSystemHealth(
  payload: ApiResponse<SystemHealthData>
): SystemHealthData {
  const data = unwrapData(payload);
  if (
    !data ||
    typeof data !== 'object' ||
    typeof data.status !== 'string' ||
    !data.application ||
    !data.database ||
    !data.runtime
  ) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return data;
}

export async function getSystemHealth(): Promise<SystemHealthData> {
  const response = await api.get<ApiResponse<SystemHealthData>>(
    '/admin/system-health'
  );
  return unwrapSystemHealth(response.data);
}

export const adminSystemHealthApi = {
  getSystemHealth,
};
