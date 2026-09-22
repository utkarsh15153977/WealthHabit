import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { isAppError } from '../utils/errors.js';
import { env } from '../config/index.js';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response
) => {
  if (isAppError(err)) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors,
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
    });
  }

  console.error('Unexpected error:', err);

  const message = env.isDevelopment ? err.message : 'Internal Server Error';
  return res.status(500).json({
    success: false,
    message,
  });
};

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
};