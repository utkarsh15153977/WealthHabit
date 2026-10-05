import api from './api';
import type { ApiResponse } from '../types/api';
import type { ResendVerificationResponse, VerifyEmailResponse } from '../types/auth';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

/**
 * Consumes a verification token.
 *
 * `POST` with the token in the body, never a query string: the browser has to
 * read the token from the link it landed on, but sending it in the URL would
 * push it into every server access log and proxy log on the way.
 */
export async function verifyEmail(token: string): Promise<VerifyEmailResponse> {
  const response = await api.post<ApiResponse<VerifyEmailResponse>>('/auth/verify-email', { token });
  return unwrapData(response.data);
}

/**
 * Requests a new verification email. The server answers with the same generic
 * message whether or not the account exists, so the result deliberately carries
 * no information about the outcome.
 */
export async function resendVerification(email: string): Promise<ResendVerificationResponse> {
  const response = await api.post<ApiResponse<ResendVerificationResponse>>(
    '/auth/resend-verification',
    { email }
  );
  return unwrapData(response.data);
}

export const emailVerificationApi = {
  verifyEmail,
  resendVerification,
};