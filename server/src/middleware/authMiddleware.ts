import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AccountStatus } from '@prisma/client';
import { env } from '../config/index.js';
import { JwtPayload, AuthenticatedUser, AuthErrorCodes } from '../types/auth.js';
import { findUserById, isUserActive } from '../services/prismaAuthService.js';
import { AppError } from '../utils/errors.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

const JWT_ALGORITHM = 'HS256' as const;

function validateJwtPayload(payload: unknown): asserts payload is JwtPayload {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Invalid token payload', 401, undefined, AuthErrorCodes.TOKEN_INVALID);
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.sub !== 'string' || !p.sub) {
    throw new AppError('Invalid token: missing subject', 401, undefined, AuthErrorCodes.TOKEN_INVALID);
  }

  if (typeof p.role !== 'string' || !Object.values(['USER', 'ADMIN']).includes(p.role)) {
    throw new AppError('Invalid token: missing or invalid role', 401, undefined, AuthErrorCodes.TOKEN_INVALID);
  }

  if (p.type !== 'access') {
    throw new AppError('Invalid token type', 401, undefined, AuthErrorCodes.TOKEN_INVALID);
  }

  if (typeof p.exp !== 'number' || p.exp * 1000 < Date.now()) {
    throw new AppError('Access token expired', 401, undefined, AuthErrorCodes.TOKEN_EXPIRED);
  }
}

export const authenticate = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
    }

    const token = authHeader.slice(7);

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
        algorithms: [JWT_ALGORITHM],
      }) as JwtPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError('Access token expired', 401, undefined, AuthErrorCodes.TOKEN_EXPIRED);
      }
      if (err instanceof jwt.JsonWebTokenError) {
        throw new AppError('Invalid access token', 401, undefined, AuthErrorCodes.TOKEN_INVALID);
      }
      throw new AppError('Invalid access token', 401, undefined, AuthErrorCodes.TOKEN_INVALID);
    }

    validateJwtPayload(payload);

    const user = await findUserById(payload.sub);

    if (!user) {
      throw new AppError('User not found', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
    }

    const active = await isUserActive(user);
    if (!active) {
      if (user.status === AccountStatus.DEACTIVATED) {
        throw new AppError('Account deactivated', 403, undefined, AuthErrorCodes.ACCOUNT_DEACTIVATED);
      }
      throw new AppError('Account is not active', 403, undefined, AuthErrorCodes.ACCOUNT_SUSPENDED);
    }

    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
    };

    next();
  } catch (err) {
    next(err);
  }
};

export const optionalAuth = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7);

    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
        algorithms: [JWT_ALGORITHM],
      }) as JwtPayload;

      validateJwtPayload(payload);

      if (payload.type === 'access') {
        const user = await findUserById(payload.sub);

        if (user && (await isUserActive(user))) {
          req.user = {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            status: user.status,
          };
        }
      }
    } catch {
      // Ignore token errors for optional auth
    }

    next();
  } catch (err) {
    next(err);
  }
};