import { Response } from 'express';
import { env } from '../config/index.js';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import {
  RegisterInput,
  LoginInput,
  ResendVerificationInput,
  VerifyEmailInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from '../schemas/authSchemas.js';
import { authService } from '../services/authService.js';
import { mfaService } from '../services/mfaService.js';
import {
  emailVerificationMessages,
  emailVerificationService,
} from '../services/emailVerificationService.js';
import {
  passwordResetMessages,
  passwordResetService,
} from '../services/passwordResetService.js';
import {
  findUserByEmail,
  createUserWithProfile,
  createSession,
  findSessionByRefreshTokenHash,
  revokeSession,
  revokeAllUserSessions,
  updateLastLoginAt,
  rotateSession,
  getAuthenticatedUser,
  detectRefreshTokenReuse,
  revokeTokenFamily,
} from '../services/prismaAuthService.js';
import { AppError } from '../utils/errors.js';
import { AuthErrorCodes } from '../types/auth.js';
import {
  RegisterData,
  LoginData,
  MfaChallengeData,
  RefreshData,
  MeData,
  LogoutData,
  ResendVerificationData,
  VerifyEmailData,
  ForgotPasswordData,
  ResetPasswordData,
} from '../types/auth.js';

export async function register(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const input = req.body as RegisterInput;

  const existingUser = await findUserByEmail(input.email);
  if (existingUser) {
    throw new AppError('Email already registered', 409, undefined, AuthErrorCodes.EMAIL_EXISTS);
  }

  const passwordHash = await authService.hashPassword(input.password);

  const { user } = await createUserWithProfile(
    input.email,
    passwordHash,
    input.firstName,
    input.lastName
  );

  // The account is created unverified (`emailVerifiedAt` is null by default) and
  // its first single-use link is issued here. This is deliberately a separate
  // step from `createUserWithProfile` rather than an extra statement inside that
  // transaction: token delivery is best-effort, and `issueInitialEmailVerification`
  // never throws, so a mail-provider outage cannot fail an otherwise valid
  // registration. A user whose first email never arrived can always ask for
  // another through the resend endpoint.
  await emailVerificationService.issueInitialEmailVerification({
    userId: user.id,
    firstName: user.firstName,
    to: user.email,
  });

  const refreshToken = authService.generateRefreshToken();
  const refreshTokenHash = authService.hashRefreshToken(refreshToken);
  const expiresAt = authService.calculateRefreshExpiry();

  await createSession(user.id, refreshTokenHash, expiresAt);
  authService.setRefreshCookie(res, refreshToken);

  const accessToken = authService.generateAccessToken(user);

  const data: RegisterData = {
    user: authService.toAuthenticatedUser(user),
    accessToken,
    message: 'Registration successful. Please verify your email.',
  };

  res.status(201).json({
    success: true,
    data,
  });
}

/**
 * Consumes a verification token and confirms the address.
 *
 * Unauthenticated by necessity: the token in the request body is the only
 * credential. Deliberately a `POST` — a `GET /verify-email?token=…` would put
 * the live token into morgan's access log and any intermediary request log,
 * which the strict body-based contract keeps out of every log line.
 */
export async function verifyEmail(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const input = req.body as VerifyEmailInput;

  const result = await emailVerificationService.verifyEmailWithToken(input.token);

  if (!result.verified) {
    throw emailVerificationService.invalidEmailVerificationLink();
  }

  const data: VerifyEmailData = {
    message: emailVerificationMessages.verified,
    emailVerified: true,
  };

  res.json({
    success: true,
    data,
  });
}

/**
 * Requests a fresh verification email.
 *
 * The response is byte-identical for a real unverified account, an already
 * verified account, a non-ACTIVE account and an address that does not exist, and
 * the response body never mentions the outcome — so the endpoint cannot be used
 * to enumerate accounts.
 */
export async function resendVerification(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const input = req.body as ResendVerificationInput;

  await emailVerificationService.resendEmailVerification(input.email);

  const data: ResendVerificationData = {
    message: emailVerificationMessages.resend,
  };

  res.json({
    success: true,
    data,
  });
}

/**
 * Requests a password-reset email.
 *
 * The response is byte-identical for a real account, an unverified account, a
 * suspended or deactivated account, an address inside its cooldown, an address
 * that does not exist, and a mail-transport failure, and the body never mentions
 * the outcome — so the endpoint cannot be used to enumerate accounts or to
 * confirm that a guessed address is registered.
 *
 * Unauthenticated by necessity; the rate limiter is mounted ahead of this
 * handler (and ahead of schema validation) so a probe flood is bounded before
 * it reaches the database.
 */
export async function forgotPassword(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const input = req.body as ForgotPasswordInput;

  await passwordResetService.requestPasswordReset(input.email);

  const data: ForgotPasswordData = {
    message: passwordResetMessages.forgot,
  };

  res.json({
    success: true,
    data,
  });
}

/**
 * Consumes a reset token and installs the new password.
 *
 * Unauthenticated: the token in the request body is the only credential, and it
 * is sent in the body rather than a query string so the live token never lands
 * in the access log of this server or any proxy in front of it. Every unusable
 * token — unknown, expired, already used, wrong type, or belonging to an
 * ineligible account — produces the same status, code and message.
 */
export async function resetPassword(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const input = req.body as ResetPasswordInput;

  const result = await passwordResetService.resetPasswordWithToken(
    input.token,
    input.newPassword
  );

  if (!result.reset) {
    throw passwordResetService.invalidPasswordResetLink();
  }

  const data: ResetPasswordData = {
    message: passwordResetMessages.resetSuccess,
  };

  res.json({
    success: true,
    data,
  });
}

export async function login(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const input = req.body as LoginInput;

  const user = await findUserByEmail(input.email);

  if (!user) {
    // Burn the same single Argon2 verification as the wrong-password path so
    // response timing does not reveal that the account does not exist. The
    // outcome is unchanged: the same 401 INVALID_CREDENTIALS either way.
    await authService.verifyPassword(authService.DUMMY_PASSWORD_HASH, input.password);
    throw new AppError('Invalid email or password', 401, undefined, AuthErrorCodes.INVALID_CREDENTIALS);
  }

  const validPassword = await authService.verifyPassword(user.passwordHash, input.password);

  if (!validPassword) {
    throw new AppError('Invalid email or password', 401, undefined, AuthErrorCodes.INVALID_CREDENTIALS);
  }

  if (user.status !== 'ACTIVE') {
    if (user.status === 'SUSPENDED') {
      throw new AppError('Account suspended', 403, undefined, AuthErrorCodes.ACCOUNT_SUSPENDED);
    }
    if (user.status === 'DEACTIVATED') {
      throw new AppError('Account deactivated', 403, undefined, AuthErrorCodes.ACCOUNT_DEACTIVATED);
    }
    throw new AppError('Account not active', 403, undefined, AuthErrorCodes.ACCOUNT_SUSPENDED);
  }

  // Second factor required: stop here with a challenge, no session. The
  // client exchanges `challengeToken` (plus a TOTP or recovery code) at
  // /api/auth/2fa/challenge or /api/auth/2fa/recovery, which complete login.
  const twoFactorState = await mfaService.getTwoFactorState(user.id);
  if (twoFactorState.enabled) {
    const { challengeToken, expiresInSeconds } = await mfaService.createLoginChallenge(user.id);

    const data: MfaChallengeData = {
      requiresTwoFactor: true,
      challengeToken,
      expiresInSeconds,
    };

    res.json({ success: true, data });
    return;
  }

  const refreshToken = authService.generateRefreshToken();
  const refreshTokenHash = authService.hashRefreshToken(refreshToken);
  const expiresAt = authService.calculateRefreshExpiry();

  await createSession(user.id, refreshTokenHash, expiresAt);
  authService.setRefreshCookie(res, refreshToken);

  await updateLastLoginAt(user.id);

  const accessToken = authService.generateAccessToken(user);

  const data: LoginData = {
    user: authService.toAuthenticatedUser(user),
    accessToken,
  };

  res.json({
    success: true,
    data,
  });
}

export async function refresh(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const cookieName = env.COOKIE_NAME;
  const cookieToken = req.cookies?.[cookieName];

  if (!cookieToken) {
    throw new AppError('Refresh token required', 401, undefined, AuthErrorCodes.TOKEN_INVALID);
  }

  const refreshTokenHash = authService.hashRefreshToken(cookieToken);
  const { session, reuseDetected, tokenFamilyId } = await detectRefreshTokenReuse(refreshTokenHash);

  if (reuseDetected && tokenFamilyId) {
    await revokeTokenFamily(tokenFamilyId);
    throw new AppError('Token reuse detected. Session revoked.', 401, undefined, AuthErrorCodes.TOKEN_REVOKED);
  }

  if (!session) {
    throw new AppError('Invalid refresh token', 401, undefined, AuthErrorCodes.TOKEN_REVOKED);
  }

  if (session.revokedAt) {
    throw new AppError('Session revoked', 401, undefined, AuthErrorCodes.TOKEN_REVOKED);
  }

  if (session.expiresAt < new Date()) {
    throw new AppError('Refresh token expired', 401, undefined, AuthErrorCodes.TOKEN_EXPIRED);
  }

  const user = await getAuthenticatedUser(session.userId);
  if (!user) {
    throw new AppError('User not found', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  // Refresh must not extend the life of a session belonging to an account that
  // is no longer active. The access token minted below would be rejected by
  // `authenticate` regardless (it re-reads status from the database on every
  // request), but the session row and the refresh cookie must not be renewed
  // either — otherwise a suspension leaves a usable refresh path behind.
  if (user.status !== 'ACTIVE') {
    if (user.status === 'SUSPENDED') {
      throw new AppError('Account suspended', 403, undefined, AuthErrorCodes.ACCOUNT_SUSPENDED);
    }
    if (user.status === 'DEACTIVATED') {
      throw new AppError('Account deactivated', 403, undefined, AuthErrorCodes.ACCOUNT_DEACTIVATED);
    }
    throw new AppError('Account not active', 403, undefined, AuthErrorCodes.ACCOUNT_SUSPENDED);
  }

  const newRefreshToken = authService.generateRefreshToken();
  const newRefreshTokenHash = authService.hashRefreshToken(newRefreshToken);
  const newExpiresAt = authService.calculateRefreshExpiry();

  const rotation = await rotateSession(
    session.id,
    refreshTokenHash,
    newRefreshTokenHash,
    newExpiresAt
  );

  if (!rotation.rotated) {
    await revokeTokenFamily(session.tokenFamilyId);
    throw new AppError('Token reuse detected. Session revoked.', 401, undefined, AuthErrorCodes.TOKEN_REVOKED);
  }

  authService.setRefreshCookie(res, newRefreshToken);

  const accessToken = authService.generateAccessToken({ id: user.id, role: user.role });

  const data: RefreshData = { accessToken };

  res.json({
    success: true,
    data,
  });
}

export async function logout(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const cookieName = env.COOKIE_NAME;
  const cookieToken = req.cookies?.[cookieName];

  if (cookieToken) {
    const refreshTokenHash = authService.hashRefreshToken(cookieToken);
    const session = await findSessionByRefreshTokenHash(refreshTokenHash);

    if (session && !session.revokedAt) {
      await revokeSession(session.id);
    }
  }

  authService.clearRefreshCookie(res);

  const data: LogoutData = { message: 'Logged out successfully' };

  res.json({
    success: true,
    data,
  });
}

export async function logoutAll(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  await revokeAllUserSessions(req.user.id);
  authService.clearRefreshCookie(res);

  const data: LogoutData = { message: 'All sessions revoked' };

  res.json({
    success: true,
    data,
  });
}

export async function me(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  const user = await getAuthenticatedUser(req.user.id);

  if (!user) {
    throw new AppError('User not found', 404, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  const data: MeData = { user };

  res.json({
    success: true,
    data,
  });
}