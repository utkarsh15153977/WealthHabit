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
  /**
   * Discriminant shared with `MfaChallengeData`. Absent on a successful
   * (session-granting) response; always `true` when 2FA is required instead.
   */
  requiresTwoFactor?: false;
}

/**
 * What a login returns when the account has 2FA enabled: no session yet, just
 * a short-lived challenge token. The caller must trade it (with a TOTP code or
 * a recovery code) for a real session at the challenge or recovery endpoint.
 */
export interface MfaChallengeData {
  requiresTwoFactor: true;
  challengeToken: string;
  expiresInSeconds: number;
}

/** Login/registration responses are either a session or a 2FA challenge. */
export type LoginResult = AuthResponse | MfaChallengeData;

/** Issued once at the start of enrollment; feeds the QR code the user scans. */
export interface MfaSetupData {
  secret: string;
  otpauthUri: string;
  expiresAt: string;
}

/** Plaintext recovery codes, returned once at enable/regenerate time. */
export interface MfaRecoveryCodesData {
  recoveryCodes: string[];
}

export interface MfaActionData {
  message: string;
}

/** Read-only state shown on the Profile security card. */
export interface MfaStatusData {
  twoFactorEnabled: boolean;
  setupPending: boolean;
}

export interface MfaSetupRequest {
  password: string;
}

/** TOTP code from the authenticator app at enable time. */
export interface MfaEnableRequest {
  code: string;
}

export interface MfaDisableRequest {
  password: string;
  code: string;
}

/** Same re-authentication shape as disable; only the new codes differ. */
export type MfaRegenerateRequest = MfaDisableRequest;

export interface MfaChallengeRequest {
  challengeToken: string;
  code: string;
}

export interface MfaRecoveryRequest {
  challengeToken: string;
  recoveryCode: string;
}

export interface VerifyEmailResponse {
  message: string;
  emailVerified: boolean;
}

export interface ResendVerificationResponse {
  message: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

/** The same shape and message the backend returns for every outcome. */
export interface ForgotPasswordResponse {
  message: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface ResetPasswordResponse {
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
