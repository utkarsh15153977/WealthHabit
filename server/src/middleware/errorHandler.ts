import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { isAppError } from '../utils/errors.js';
import { env } from '../config/index.js';
import { AuthErrorCodes } from '../types/auth.js';
import { logger } from '../utils/logger.js';
import { ensureRequestId } from './requestId.js';

/**
 * A body-parser (raw-body) rejection: it always carries `type: "entity.*"`,
 * a 4xx `status` and, for parse failures, the underlying `SyntaxError`.
 * Distinguished from a genuine application error so it keeps its own status
 * code instead of becoming a 500.
 */
interface BodyParserError extends Error {
  type?: string;
  status: number;
  statusCode?: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as BodyParserError;
  return (
    typeof candidate.type === 'string' &&
    candidate.type.startsWith('entity.') &&
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status < 500
  );
}

export const errorHandler = (
  err: Error,
  req: Request,
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

  // body-parser rejections (oversized body, malformed JSON) carry their own
  // 4xx status. Without this branch they fall through to the generic handler
  // below, turning a client mistake into a logged "Unexpected error" 500 and
  // hiding the real reason (`entity.too.large`) from the caller.
  if (isBodyParserError(err)) {
    const status = err.status;
    const message = status === 413 ? 'Request body too large' : 'Invalid request body';
    return res.status(status).json({
      success: false,
      message,
      error: {
        code: AuthErrorCodes.VALIDATION_ERROR,
        message,
      },
    });
  }

  // Correlates this 500 with the X-Request-Id echoed to the client. The
  // logger redacts secrets in every string field (5G.3 protection) while
  // keeping the full server-side stack trace for diagnosis.
  const requestId = ensureRequestId(req, res);
  logger.error('Unexpected error', {
    requestId,
    status: 500,
    method: req.method,
    path: req.path,
    errorName: err.name,
    errorMessage: err.message,
    stack: err.stack,
  });

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
