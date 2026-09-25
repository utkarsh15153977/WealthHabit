import { Response } from 'express';
import { env } from '../config/index.js';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { RegisterInput, LoginInput } from '../schemas/authSchemas.js';
import { authService } from '../services/authService.js';
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
import { RegisterData, LoginData, RefreshData, MeData, LogoutData } from '../types/auth.js';

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

  const refreshToken = authService.generateRefreshToken();
  const refreshTokenHash = authService.hashRefreshToken(refreshToken);
  const expiresAt = authService.calculateRefreshExpiry();

  await createSession(user.id, refreshTokenHash, expiresAt);
  authService.setRefreshCookie(res, refreshToken);

  const accessToken = authService.generateAccessToken(user);

  const data: RegisterData = {
    user: authService.toAuthenticatedUser(user),
    accessToken,
  };

  res.status(201).json({
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

  const newRefreshToken = authService.generateRefreshToken();
  const newRefreshTokenHash = authService.hashRefreshToken(newRefreshToken);
  const newExpiresAt = authService.calculateRefreshExpiry();

  await rotateSession(session.id, newRefreshTokenHash, newExpiresAt);
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