import { Request, Response, NextFunction } from 'express';
import { env } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { ensureRequestId } from './requestId.js';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = ensureRequestId(req, res);

  if (env.isDevelopment) {
    console.log(`${req.method} ${req.path}`);
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    // Minimal, safe request metadata only: no headers, cookies, query string
    // or body. The request ID ties this line to any error logged for the
    // same request.
    logger.info('request completed', {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
    });
    if (env.isDevelopment) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });

  next();
};
