import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/index.js';

const windowMs = 15 * 60 * 1000; // 15 minutes

export const LOGIN_RATE_LIMIT_MAX = env.isDevelopment ? 20 : 5;

/**
 * Budget for `POST /api/auth/resend-verification`. Deliberately the same
 * magnitude as the login limiter: both are unauthenticated, per-account
 * endpoints where the interesting abuse is "hammer one address from one client",
 * so 5 requests / 15 min per (account, IP) in production matches the existing
 * precedent instead of inventing a new policy. The per-account *cooldown*
 * (default 60s) is enforced separately and durably by
 * `emailVerificationService`, because this in-memory counter is process-local.
 */
export const RESEND_VERIFICATION_RATE_LIMIT_MAX = env.isDevelopment ? 20 : 5;

/**
 * Normalizes the submitted email exactly like the login path does
 * (`loginSchema` and `findUserByEmail` both apply `toLowerCase().trim()`), so
 * every casing/whitespace variant of one address shares a single bucket.
 * Returns `undefined` when no usable email is present so the caller can fall
 * back to an IP-only key instead of minting unbounded distinct keys.
 */
export function normalizeLoginEmail(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;

  const email = (body as { email?: unknown }).email;
  if (typeof email !== 'string') return undefined;

  const normalized = email.trim().toLowerCase();
  return normalized === '' ? undefined : normalized;
}

/**
 * Builds the login limiter key as an unambiguous JSON pair so an email cannot
 * contain a separator that forges another client's key. The IP part must
 * already come from `ipKeyGenerator(request.ip, 56)` — the address Express
 * derives from the configured `trust proxy` boundary, never a raw
 * `X-Forwarded-For` entry.
 */
export function buildLoginRateLimitKey(email: string | undefined, ip: string): string {
  return buildScopedRateLimitKey('login', email, ip);
}

/**
 * Builds a rate-limit key as an unambiguous JSON pair list so a submitted email
 * cannot contain a separator that forges another client's key. The IP part must
 * already come from `ipKeyGenerator(request.ip, 56)` — the address Express
 * derives from the configured `trust proxy` boundary, never a raw
 * `X-Forwarded-For` entry.
 *
 * The scope keeps each endpoint's buckets independent while sharing one
 * normalization and one key format.
 */
export function buildScopedRateLimitKey(
  scope: string,
  email: string | undefined,
  ip: string
): string {
  return JSON.stringify([scope, email ?? null, ip]);
}

export const authRateLimit = rateLimit({
  windowMs,
  max: env.isDevelopment ? 100 : 20,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strict limiter for `POST /api/auth/login` only, keyed by normalized email +
 * trusted client IP (`req.ip` under the configured `trust proxy` boundary).
 * Runs before validation and before any account lookup, so the budget is
 * identical whether or not the account exists — it never becomes an
 * account-existence oracle.
 */
export const loginRateLimit = rateLimit({
  windowMs,
  max: LOGIN_RATE_LIMIT_MAX,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) =>
    buildLoginRateLimitKey(
      normalizeLoginEmail(request.body),
      ipKeyGenerator(request.ip ?? '', 56)
    ),
});

/**
 * Limiter for `POST /api/auth/resend-verification`, keyed by normalized email +
 * trusted client IP exactly like the login limiter, and mounted before schema
 * validation and before any account lookup. That ordering matters for
 * anti-enumeration: the budget is spent identically whether or not the address
 * exists, so a 429 can never distinguish a real account from a guess.
 *
 * `POST /api/auth/verify-email` deliberately gets no such limiter. It is keyed
 * by an unguessable single-use token rather than by attacker-chosen input, so a
 * per-account bucket would only let one attacker lock a victim out of verifying
 * their own address. It stays on the general `authRateLimit` (per-IP), which
 * bounds the request volume without an account-lockout side effect.
 */
export const resendVerificationRateLimit = rateLimit({
  windowMs,
  max: RESEND_VERIFICATION_RATE_LIMIT_MAX,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) =>
    buildScopedRateLimitKey(
      'resend-verification',
      normalizeLoginEmail(request.body),
      ipKeyGenerator(request.ip ?? '', 56)
    ),
});

export const apiRateLimit = rateLimit({
  windowMs,
  max: env.isDevelopment ? 500 : 100,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
