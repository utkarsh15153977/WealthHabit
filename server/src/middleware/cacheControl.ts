import { Request, Response, NextFunction } from 'express';

/**
 * Marks API responses as non-cacheable.
 *
 * This is a financial API: a dashboard or transaction payload sitting in a
 * shared cache, or surviving in a browser's back/forward cache on a shared
 * device, is a data-disclosure problem. `private` stops shared caches from
 * storing the response and `no-store` stops the browser from keeping it.
 *
 * Applied before the route runs, so a handler that needs a specific value
 * (reports and the one-time MFA code page send plain `no-store`) simply calls
 * `res.setHeader('Cache-Control', ...)` and overwrites this default — Node's
 * header map is last-write-wins.
 *
 * Only `/api` is affected: the application serves no static assets of its own.
 */
export function noStoreApiResponses(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}
