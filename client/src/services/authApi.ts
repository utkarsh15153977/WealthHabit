import api, { refreshAccessToken } from './api';
import type { ApiResponse } from '../types/api';
import type {
  AuthResponse,
  LoginRequest,
  LogoutResponse,
  MeResponse,
  RegisterRequest,
} from '../types/auth';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const response = await api.post<ApiResponse<AuthResponse>>('/auth/register', data);
  return unwrapData(response.data);
}

export async function login(data: LoginRequest): Promise<AuthResponse> {
  const response = await api.post<ApiResponse<AuthResponse>>('/auth/login', data);
  return unwrapData(response.data);
}

export const refresh = refreshAccessToken;

export async function logout(): Promise<void> {
  await api.post<ApiResponse<LogoutResponse>>('/auth/logout', {});
}

export async function logoutAll(): Promise<void> {
  await api.post<ApiResponse<LogoutResponse>>('/auth/logout-all', {});
}

export async function me(): Promise<MeResponse> {
  const response = await api.get<ApiResponse<MeResponse>>('/auth/me');
  return unwrapData(response.data);
}

export const authApi = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  me,
};
