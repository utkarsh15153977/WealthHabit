import api, { refreshAccessToken } from './api';
import type { ApiResponse } from '../types/api';
import type {
  AuthResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  LoginRequest,
  LoginResult,
  LogoutResponse,
  MeResponse,
  MfaActionData,
  MfaChallengeRequest,
  MfaDisableRequest,
  MfaEnableRequest,
  MfaRecoveryCodesData,
  MfaRecoveryRequest,
  MfaRegenerateRequest,
  MfaSetupData,
  MfaSetupRequest,
  MfaStatusData,
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

export async function login(data: LoginRequest): Promise<LoginResult> {
  const response = await api.post<ApiResponse<LoginResult>>('/auth/login', data);
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

/** Starts enrollment: re-authenticates and returns the TOTP secret + URI. */
export async function setupMfa(data: MfaSetupRequest): Promise<MfaSetupData> {
  const response = await api.post<ApiResponse<MfaSetupData>>('/auth/2fa/setup', data);
  return unwrapData(response.data);
}

/**
 * Confirms enrollment with a live TOTP code and activates 2FA. The recovery
 * codes are returned in plaintext exactly once.
 */
export async function enableMfa(data: MfaEnableRequest): Promise<MfaRecoveryCodesData> {
  const response = await api.post<ApiResponse<MfaRecoveryCodesData>>('/auth/2fa/enable', data);
  return unwrapData(response.data);
}

export async function disableMfa(data: MfaDisableRequest): Promise<MfaActionData> {
  const response = await api.post<ApiResponse<MfaActionData>>('/auth/2fa/disable', data);
  return unwrapData(response.data);
}

export async function regenerateRecoveryCodes(
  data: MfaRegenerateRequest
): Promise<MfaRecoveryCodesData> {
  const response = await api.post<ApiResponse<MfaRecoveryCodesData>>(
    '/auth/2fa/recovery-codes/regenerate',
    data
  );
  return unwrapData(response.data);
}

/** Trades a login challenge token plus a TOTP code for a real session. */
export async function verifyMfaChallenge(data: MfaChallengeRequest): Promise<AuthResponse> {
  const response = await api.post<ApiResponse<AuthResponse>>('/auth/2fa/challenge', data);
  return unwrapData(response.data);
}

/** Trades a login challenge token plus a recovery code for a real session. */
export async function verifyMfaRecovery(data: MfaRecoveryRequest): Promise<AuthResponse> {
  const response = await api.post<ApiResponse<AuthResponse>>('/auth/2fa/recovery', data);
  return unwrapData(response.data);
}

/** Read-only 2FA state for the Profile security card. */
export async function getMfaStatus(): Promise<MfaStatusData> {
  const response = await api.get<ApiResponse<MfaStatusData>>('/auth/2fa/status');
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
  setupMfa,
  enableMfa,
  disableMfa,
  regenerateRecoveryCodes,
  verifyMfaChallenge,
  verifyMfaRecovery,
  getMfaStatus,
};
