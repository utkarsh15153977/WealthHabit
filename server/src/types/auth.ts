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
  /**
   * Whether the account has completed second-factor enrollment
   * (`user_mfa.enabledAt` set). When true, `/api/auth/login` answers with a
   * `requiresTwoFactor` challenge instead of a session.
   */
  twoFactorEnabled: boolean;
  /**
   * Whether a pending enrollment exists (`user_mfa` row present,
   * `enabledAt` still null) with a confirming code outstanding. Informational:
   * lets the client offer to resume the enrollment.
   */
  twoFactorPending: boolean;
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

/**
 * The answer `/api/auth/login` returns when the account has 2FA enabled,
 * instead of a session. The challenge token is short-lived, single-use, and
 * supersedes any earlier challenge for the same account; the client presents
 * it (with a TOTP code or recovery code) to `/api/auth/2fa/challenge` or
 * `/api/auth/2fa/recovery`, which complete the login.
 */
export interface MfaChallengeData {
  requiresTwoFactor: true;
  challengeToken: string;
  expiresInSeconds: number;
}

/** Issued once, at the start of enrollment; feeds the QR code the user scans. */
export interface MfaSetupData {
  secret: string;
  otpauthUri: string;
  expiresAt: string;
}

/**
 * The plaintext recovery codes, returned exactly once at enable time. Only
 * their SHA-256 digests are stored, so this is the only opportunity to see
 * them; the client must show them before moving on.
 */
export interface MfaRecoveryCodesData {
  recoveryCodes: string[];
}

export interface MfaActionData {
  message: string;
}

/** Read-only 2FA state for the Profile security card. */
export interface MfaStatusData {
  twoFactorEnabled: boolean;
  setupPending: boolean;
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

/**
 * Always the same shape and message, whether or not an account exists, was
 * eligible, was inside its cooldown, or the mail transport failed.
 */
export interface ForgotPasswordData {
  message: string;
}

export interface ResetPasswordData {
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
  /**
   * The single rejection shared by every unusable reset link: unknown token,
   * already-used token, expired token, wrong token type, or a token belonging
   * to an account that is no longer eligible. One code and one message, so a
   * caller cannot distinguish these cases.
   */
  PASSWORD_RESET_INVALID: 'PASSWORD_RESET_INVALID',
  /**
   * A re-authentication password (submitted when starting/confirming/removing
   * 2FA) did not match. This is an application-level check inside an already
   * authenticated request, returned as 400 so the client does not treat it as
   * a session failure.
   */
  PASSWORD_UNVERIFIED: 'PASSWORD_UNVERIFIED',
  MFA_ALREADY_ENABLED: 'MFA_ALREADY_ENABLED',
  MFA_NOT_ENABLED: 'MFA_NOT_ENABLED',
  MFA_SETUP_REQUIRED: 'MFA_SETUP_REQUIRED',
  MFA_SETUP_EXPIRED: 'MFA_SETUP_EXPIRED',
  MFA_CODE_INVALID: 'MFA_CODE_INVALID',
  /**
   * The single rejection shared by every unusable 2FA login attempt — wrong
   * TOTP code, unknown/used/expired/wrong-type challenge token, an account
   * whose 2FA is no longer enabled, and every failure that lost a race against
   * another request. One code and one message, so the endpoints cannot be used
   * to probe the challenge space or confirm guesses.
   */
  MFA_CHALLENGE_INVALID: 'MFA_CHALLENGE_INVALID',
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