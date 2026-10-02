import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

export const MAX_REQUEST_ID_LENGTH = 64;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

/**
 * Produces a cryptographically random request ID (UUID v4). Uses only the
 * Node built-in `crypto` module, so no dependency is added.
 */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Accepts a caller-supplied request ID only when it is short and made of
 * log-safe characters. Anything else (whitespace, newlines, separators,
 * oversized values) is rejected so a forged header can never inject content
 * into server logs or response headers.
 *
 * A request ID is correlation data only: it is never used for authorization,
 * rate limiting, caching or any other security decision.
 */
export function normalizeIncomingRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > MAX_REQUEST_ID_LENGTH) {
    return null;
  }
  if (!SAFE_REQUEST_ID_PATTERN.test(candidate)) {
    return null;
  }
  return candidate;
}

function readIncomingRequestId(req: Request): string | null {
  const raw = req.headers['x-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return normalizeIncomingRequestId(value);
}

/**
 * Returns the request ID for this request, adopting a safe incoming
 * `X-Request-Id` when present and otherwise generating a new one. The value
 * is stored on the request and echoed back via the `X-Request-Id` response
 * header. Idempotent: repeated calls return the same ID.
 */
export function ensureRequestId(req: Request, res?: Response): string {
  if (!req.requestId) {
    req.requestId = readIncomingRequestId(req) ?? generateRequestId();
    if (res && !res.headersSent) {
      res.setHeader(REQUEST_ID_HEADER, req.requestId);
    }
  }
  return req.requestId;
}

/**
 * Safe accessor for downstream middleware and handlers.
 */
export function getRequestId(req: Request): string {
  return req.requestId ?? 'no-request-id';
}

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  ensureRequestId(req, res);
  next();
};
