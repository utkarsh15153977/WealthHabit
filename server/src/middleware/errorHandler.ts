import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { isAppError } from '../utils/errors.js';
import { env } from '../config/index.js';
import { AuthErrorCodes } from '../types/auth.js';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires 4-arg signature to detect error middleware
  _next: NextFunction
) => {
  if (isAppError(err)) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors,
      error: {
        code: err.code || AuthErrorCodes.INTERNAL_ERROR,
        message: err.message,
      },
    });
  }

  if (err instanceof ZodError) {
    const errors: Record<string, string[]> = {};
    err.errors.forEach((e) => {
      const path = e.path.join('.');
      if (!errors[path]) errors[path] = [];
      errors[path].push(e.message);
    });
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
      error: {
        code: AuthErrorCodes.VALIDATION_ERROR,
        message: 'Validation failed',
      },
    });
  }

  console.error('Unexpected error:', err.name, err.message);

  const message = env.isDevelopment ? err.message : 'Internal Server Error';
  return res.status(500).json({
    success: false,
    message,
    error: {
      code: AuthErrorCodes.INTERNAL_ERROR,
      message,
    },
  });
};

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
};