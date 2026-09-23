import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from './authMiddleware.js';
import { AppError } from '../utils/errors.js';
import { AuthErrorCodes } from '../types/auth.js';

export const requireRole = (...allowedRoles: Role[]) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403, undefined, AuthErrorCodes.FORBIDDEN));
    }

    next();
  };
};

export const requireAdmin = requireRole(Role.ADMIN);

export const requireUser = requireRole(Role.USER, Role.ADMIN);