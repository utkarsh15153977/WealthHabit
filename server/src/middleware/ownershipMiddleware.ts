import { AuthenticatedRequest } from './authMiddleware.js';
import { AppError } from '../utils/errors.js';
import { AuthErrorCodes } from '../types/auth.js';

export function getAuthenticatedUserId(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
  }
  return req.user.id;
}

export function getAuthenticatedUserRole(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
  }
  return req.user.role;
}