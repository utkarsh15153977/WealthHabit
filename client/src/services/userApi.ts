import api from './api';
import type { ApiResponse } from '../types/api';
import type { ProfileResponse, UpdateProfileRequest } from '../types/user';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getMyProfile(): Promise<ProfileResponse> {
  const response = await api.get<ApiResponse<ProfileResponse>>('/users/me');
  return unwrapData(response.data);
}

export async function updateMyProfile(data: UpdateProfileRequest): Promise<ProfileResponse> {
  const response = await api.patch<ApiResponse<ProfileResponse>>('/users/me', data);
  return unwrapData(response.data);
}

export const userApi = {
  getMyProfile,
  updateMyProfile,
};
