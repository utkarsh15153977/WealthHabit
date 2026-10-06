import { Response } from 'express';
import { env } from '../config/index.js';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import {
  MfaSetupInput,
  MfaEnableInput,
  MfaDisableInput,
  MfaRegenerateInput,
  MfaChallengeInput,
  MfaRecoveryInput,
} from '../schemas/authSchemas.js';
import { authService } from '../services/authService.js';
import { findSessionByRefreshTokenHash } from '../services/prismaAuthService.js';
import { mfaService } from '../services/mfaService.js';
import { AppError } from '../utils/errors.js';
import {
  MfaSetupData,
  MfaRecoveryCodesData,
  MfaActionData,
  MfaStatusData,
  LoginData,
  AuthErrorCodes,
} from '../types/auth.js';

/**
 * Resolves the session that owns the current request from the refresh-token
 * cookie, so enabling/disabling 2FA can revoke every session EXCEPT it. A
 * missing or already-consumed cookie means the current session cannot be
 * identified — the request carries a valid access token but no live session —
 * and probably should not survive the change either.
 */
async function resolveCurrentSessionId(req: AuthenticatedRequest): Promise<string | null> {
  const cookieName = env.COOKIE_NAME;
  const cookieToken = req.cookies?.[cookieName];

  if (!cookieToken) {
    return null;
  }

  const refreshTokenHash = authService.hashRefreshToken(cookieToken);
  const session = await findSessionByRefreshTokenHash(refreshTokenHash);

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return null;
  }

  return session.id;
}

export async function mfaStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  const state = await mfaService.getTwoFactorState(req.user.id);

  const data: MfaStatusData = {
    twoFactorEnabled: state.enabled,
    setupPending: state.pending,
  };

  res.json({ success: true, data });
}

export async function mfaSetup(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  const input = req.body as MfaSetupInput;

  const result = await mfaService.startMfaSetup({
    userId: req.user.id,
    currentPassword: input.password,
  });

  const data: MfaSetupData = {
    secret: result.secret,
    otpauthUri: result.otpauthUri,
    expiresAt: result.expiresAt.toISOString(),
  };

  res.json({ success: true, data });
}

export async function mfaEnable(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  const input = req.body as MfaEnableInput;

  const result = await mfaService.enableMfa({
    userId: req.user.id,
    code: input.code,
    keepSessionId: await resolveCurrentSessionId(req),
  });

  const data: MfaRecoveryCodesData = { recoveryCodes: result.recoveryCodes };

  res.json({ success: true, data });
}

export async function mfaDisable(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  const input = req.body as MfaDisableInput;

  await mfaService.disableMfa({
    userId: req.user.id,
    password: input.password,
    code: input.code,
    keepSessionId: await resolveCurrentSessionId(req),
  });

  const data: MfaActionData = { message: 'Two-factor authentication has been disabled.' };

  res.json({ success: true, data });
}

export async function mfaRegenerateCodes(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  const input = req.body as MfaRegenerateInput;

  const result = await mfaService.regenerateRecoveryCodes({
    userId: req.user.id,
    password: input.password,
    code: input.code,
  });

  const data: MfaRecoveryCodesData = { recoveryCodes: result.recoveryCodes };

  res.json({ success: true, data });
}

/**
 * Completes a 2FA login with a TOTP code. Handles the session handed back by
 * the service (setting the refresh cookie) so the same shape as a normal
 * login reaches the client. The service itself never touches the response.
 */
export async function mfaChallenge(req: AuthenticatedRequest, res: Response): Promise<void> {
  const input = req.body as MfaChallengeInput;

  const result = await mfaService.verifyMfaLoginChallenge(input.challengeToken, input.code);

  if (!result.signedIn) {
    throw mfaService.invalidMfaChallenge();
  }

  authService.setRefreshCookie(res, result.refreshToken);

  const data: LoginData = {
    user: result.user,
    accessToken: result.accessToken,
  };

  res.json({ success: true, data });
}

export async function mfaRecovery(req: AuthenticatedRequest, res: Response): Promise<void> {
  const input = req.body as MfaRecoveryInput;

  const result = await mfaService.verifyMfaLoginRecoveryCode(input.challengeToken, input.recoveryCode);

  if (!result.signedIn) {
    throw mfaService.invalidMfaChallenge();
  }

  authService.setRefreshCookie(res, result.refreshToken);

  const data: LoginData = {
    user: result.user,
    accessToken: result.accessToken,
  };

  res.json({ success: true, data });
}