export type Role = 'USER' | 'ADMIN';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: AccountStatus;
  /** Whether the email address has been confirmed. False right after registration. */
  emailVerified: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  /** Present on registration only: a verification email has been sent. */
  message?: string;
}

export interface VerifyEmailResponse {
  message: string;
  emailVerified: boolean;
}

export interface ResendVerificationResponse {
  message: string;
}

export interface RefreshResponse {
  accessToken: string;
}

export interface MeResponse {
  user: User;
}

export interface LogoutResponse {
  message: string;
}
