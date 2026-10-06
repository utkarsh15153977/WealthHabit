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
 * Budget for `POST /api/auth/forgot-password`, keyed on (account, IP) exactly
 * like the login and resend-verification limiters, and the same magnitude as
 * those for the same reason: this is an unauthenticated per-account endpoint
 * where the interesting abuse is "hammer one address from one client" and
 * "enumerate addresses from one client", both of which a composite key stops.
 *
 * It must be mounted before any body validation or account lookup so that a
 * probe flood costs a rate-limit counter increment rather than a database
 * round trip. The per-account *cooldown* (default 300s) is enforced separately
 * and durably by `passwordResetService`, because this in-memory counter is
 * process-local and resets on deploy.
 */
export const FORGOT_PASSWORD_RATE_LIMIT_MAX = env.isDevelopment ? 20 : 5;

/**
 * Budget for `POST /api/auth/reset-password`.
 *
 * Keyed on IP alone, deliberately. Applying the limiter per submitted token
 * would be useless (tokens are unguessable) and per account is impossible
 * before the token is consumed; an IP-only key is what actually bounds the
 * resource that matters. Every valid attempt performs a full Argon2id
 * derivation, which is the most expensive thing an unauthenticated caller can
 * reach in this feature, so this budget is set at the same 5 / 15 min per
 * process as the login limiter rather than higher.
 */
export const RESET_PASSWORD_RATE_LIMIT_MAX = env.isDevelopment ? 20 : 5;

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

/**
 * Limiter for `POST /api/auth/forgot-password`, keyed by normalized email +
 * trusted client IP, mounted before schema validation and before the account
 * lookup. Same ordering argument as resend-verification: the budget is spent
 * identically whether or not the address exists, so a 429 cannot distinguish a
 * real account from a guess.
 */
export const forgotPasswordRateLimit = rateLimit({
  windowMs,
  max: FORGOT_PASSWORD_RATE_LIMIT_MAX,
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
      'forgot-password',
      normalizeLoginEmail(request.body),
      ipKeyGenerator(request.ip ?? '', 56)
    ),
});

/**
 * Limiter for `POST /api/auth/reset-password`, keyed by trusted client IP only.
 *
 * It must stay in front of the handler so that the Argon2id derivation in the
 * reset flow is reachable only within this budget — that derivation is the most
 * expensive operation an unauthenticated caller can trigger here. It cannot be
 * keyed per account, because the owner is only known after the token has been
 * consumed, and it must not be keyed per token, because the token is
 * unguessable and a per-token bucket would accomplish nothing.
 */
export const resetPasswordRateLimit = rateLimit({
  windowMs,
  max: RESET_PASSWORD_RATE_LIMIT_MAX,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => ipKeyGenerator(request.ip ?? '', 56),
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
