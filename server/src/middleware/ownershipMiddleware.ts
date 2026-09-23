import { AuthenticatedRequest } from './authMiddleware.js';
import { AppError } from '../utils/errors.js';
import { AuthErrorCodes } from '../types/auth.js';

export function assertOwnership(
  req: AuthenticatedRequest,
  resourceUserId: string,
  errorMessage = 'Access denied'
): void {
  if (!req.user) {
    throw new AppError('Authentication required', 401, undefined, AuthErrorCodes.UNAUTHORIZED);
  }

  if (req.user.id !== resourceUserId) {
    throw new AppError(errorMessage, 403, undefined, AuthErrorCodes.FORBIDDEN);
  }
}

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