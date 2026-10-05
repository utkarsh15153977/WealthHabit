import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  role: Role;
  type: 'access';
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: string;
  /**
   * Whether `users.emailVerifiedAt` is set. Registration always starts false;
   * verification flips it. Purely informational in this phase: it is reported
   * to the client but gates no endpoint (see docs/architecture.md).
   */
  emailVerified: boolean;
}

export interface RegisterData {
  user: AuthenticatedUser;
  accessToken: string;
  /** Tells the client that a verification email is on its way. */
  message: string;
}

export interface LoginData {
  user: AuthenticatedUser;
  accessToken: string;
}

export interface RefreshData {
  accessToken: string;
}

export interface MeData {
  user: AuthenticatedUser;
}

export interface LogoutData {
  message: string;
}

export interface VerifyEmailData {
  message: string;
  emailVerified: true;
}

export interface ResendVerificationData {
  message: string;
}

export interface AuthErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export const AuthErrorCodes = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  EMAIL_VERIFICATION_INVALID: 'EMAIL_VERIFICATION_INVALID',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type AuthErrorCode = typeof AuthErrorCodes[keyof typeof AuthErrorCodes];