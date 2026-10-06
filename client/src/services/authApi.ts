import api, { refreshAccessToken } from './api';
import type { ApiResponse } from '../types/api';
import type {
  AuthResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  LoginRequest,
  LogoutResponse,
  MeResponse,
  RegisterRequest,
  ResetPasswordRequest,
  ResetPasswordResponse,
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

/**
 * Requests a reset email. The resolved value is deliberately the generic
 * message, so the caller has no way to display anything account-specific.
 */
export async function forgotPassword(
  data: ForgotPasswordRequest
): Promise<ForgotPasswordResponse> {
  const response = await api.post<ApiResponse<ForgotPasswordResponse>>(
    '/auth/forgot-password',
    data
  );
  return unwrapData(response.data);
}

/** Consumes a reset token. The token travels in the body, never in the URL. */
export async function resetPassword(
  data: ResetPasswordRequest
): Promise<ResetPasswordResponse> {
  const response = await api.post<ApiResponse<ResetPasswordResponse>>(
    '/auth/reset-password',
    data
  );
  return unwrapData(response.data);
}

export const authApi = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  me,
  forgotPassword,
  resetPassword,
};
