import { isIP } from 'node:net';
import { config } from 'dotenv';
config();

/**
 * Placeholder values that are published in tracked template files, most
 * importantly `server/.env.production.example`. The documented production
 * workflow copies that file to `server/.env.production`, so an operator who
 * replaces only `DATABASE_URL` and `CLIENT_URL` leaves the placeholder in
 * place. These values are deliberately longer than the 32-character minimum,
 * so the length rule alone cannot catch them: the server would start and sign
 * production tokens with signing material that is public in the repository,
 * letting anyone forge a token for any account.
 *
 * Compared case-insensitively after trimming, so a cosmetic edit (casing,
 * trailing whitespace) cannot bypass the check.
 */
const JWT_SECRET_PLACEHOLDER_VALUES = [
  'replace-with-at-least-32-random-characters-from-a-secret-store',
];

/**
 * Anchored, deliberately narrow near-variant guard for the same published
 * placeholder family (different separator style or a shortened tail), so the
 * template cannot be bypassed by editing only the wording. A genuinely
 * generated secret (hex, base64 or base64url) cannot realistically collide
 * with these English word prefixes.
 */
const JWT_SECRET_PLACEHOLDER_PATTERN =
  /^(replace[-_\s]?with|change[-_\s]?me|change[-_\s]?this|your[-_\s]?(jwt[-_\s]?)?(access[-_\s]?)?secret)/i;

function isJwtSecretPlaceholder(secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  return (
    JWT_SECRET_PLACEHOLDER_VALUES.includes(normalized) ||
    JWT_SECRET_PLACEHOLDER_PATTERN.test(normalized)
  );
}

function validateJwtSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET must be set in production');
    }
    return 'dev-secret-change-in-production';
  }

  if (secret === 'dev-secret-change-in-production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET cannot be the default development value in production');
    }
    console.warn('WARNING: JWT_ACCESS_SECRET is using the default development value. Use a custom secret in production.');
    return secret;
  }

  if (isJwtSecretPlaceholder(secret)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_ACCESS_SECRET is still the placeholder value from server/.env.production.example. ' +
          'Generate a unique secret and inject it from a secret store.'
      );
    }
    console.warn('WARNING: JWT_ACCESS_SECRET looks like a template placeholder. Use a unique secret in production.');
  }

  if (secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_ACCESS_SECRET must be at least 32 characters in production');
    }
    console.warn('WARNING: JWT_ACCESS_SECRET is less than 32 characters. Use a stronger secret in production.');
  }

  return secret;
}

/**
 * Placeholder values published in tracked template files
 * (`server/.env.production.example`), so an operator who copies the template
 * and replaces only `DATABASE_URL` and `CLIENT_URL` leaves the MFA encryption
 * placeholder in place and production refuses to start rather than deriving a
 * predictable AES key. Matched case-insensitively after trimming, exactly like
 * the JWT check.
 */
const MFA_ENCRYPTION_PLACEHOLDER_VALUES = [
  'replace-with-at-least-32-random-characters-from-a-secret-store',
];

const MFA_ENCRYPTION_PLACEHOLDER_PATTERN =
  /^(replace[-_\s]?with|change[-_\s]?me|change[-_\s]?this|your[-_\s]?mfa[-_\s]?secret)/i;

function isMfaEncryptionPlaceholder(secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  return (
    MFA_ENCRYPTION_PLACEHOLDER_VALUES.includes(normalized) ||
    MFA_ENCRYPTION_PLACEHOLDER_PATTERN.test(normalized)
  );
}

/**
 * Resolves the raw material for the AES-256-GCM key that protects stored TOTP
 * secrets at rest. The AES key itself is derived in `crypto/aesGcm.ts` as the
 * SHA-256 of this value; this resolver only makes sure a sane value exists.
 *
 * Same fail-closed shape as `validateJwtSecret`: development/test silently
 * fall back to a published default (acceptable because a dev database holds no
 * real secrets), while production throws on a missing, default, short or
 * placeholder value. A stored TOTP secret encrypted under a placeholder key
 * would be decryptable by anyone reading the repository, which is exactly the
 * JWT-placeholder hazard only worse (secrets are long-lived material).
 */
function validateMfaEncryptionKey(): string {
  const secret = process.env.MFA_SECRET_ENCRYPTION_KEY;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MFA_SECRET_ENCRYPTION_KEY must be set in production');
    }
    return 'dev-mfa-encryption-key-change-in-production';
  }

  if (secret === 'dev-mfa-encryption-key-change-in-production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'MFA_SECRET_ENCRYPTION_KEY cannot be the default development value in production'
      );
    }
    console.warn(
      'WARNING: MFA_SECRET_ENCRYPTION_KEY is using the default development value. ' +
        'Use a custom key in production.'
    );
    return secret;
  }

  if (isMfaEncryptionPlaceholder(secret)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'MFA_SECRET_ENCRYPTION_KEY is still the placeholder value from server/.env.production.example. ' +
          'Generate a unique key and inject it from a secret store.'
      );
    }
    console.warn(
      'WARNING: MFA_SECRET_ENCRYPTION_KEY looks like a template placeholder. Use a unique key in production.'
    );
  }

  if (secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MFA_SECRET_ENCRYPTION_KEY must be at least 32 characters in production');
    }
    console.warn(
      'WARNING: MFA_SECRET_ENCRYPTION_KEY is less than 32 characters. Use a stronger key in production.'
    );
  }

  return secret;
}

/**
 * The refresh cookie must never travel over plain HTTP. Development and test
 * stay env-driven (`COOKIE_SECURE` unset/false keeps cookies usable locally);
 * production is forced secure so an unset or `false` value cannot silently
 * downgrade it.
 */
function resolveCookieSecure(): boolean {
  const requested = process.env.COOKIE_SECURE === 'true';

  if (process.env.NODE_ENV !== 'production') {
    return requested;
  }

  if (!requested) {
    console.warn(
      'WARNING: COOKIE_SECURE is not enabled but NODE_ENV=production. Forcing secure cookies so the refresh cookie is never sent over plain HTTP.'
    );
  }

  return true;
}

/**
 * Parses an operator-supplied positive integer setting, failing closed to the
 * built-in default when the value is missing or nonsensical. A silently
 * accepted `NaN` here would turn a token TTL into an immediately expired token
 * (or, worse, `NaN` milliseconds in the past for every one of them), so an
 * unusable value is reported and replaced rather than propagated.
 */
function resolveBoundedInt(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const value = raw?.trim();

  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    console.warn(
      `WARNING: ${name}="${value}" is not a whole number between ${min} and ${max}. ` +
        `Falling back to the default (${fallback}).`
    );
    return fallback;
  }

  return parsed;
}

export type EmailTransportKind = 'memory' | 'webhook';

/**
 * Email delivery transport.
 *
 * `memory` is the development/test transport: messages are captured in-process
 * and nothing leaves the server. It is NEVER a production transport, so a
 * production deployment that leaves it (or nothing) configured is warned about
 * loudly at start-up rather than silently accepting that no verification email
 * can ever be delivered.
 *
 * `webhook` is the operator-provided integration point: the message is POSTed
 * as JSON to `EMAIL_WEBHOOK_URL`, authenticated with `EMAIL_WEBHOOK_TOKEN`. The
 * endpoint itself (and whatever upstream provider it forwards to) is supplied
 * per deployment, which keeps the provider SDK out of the application.
 */
function resolveEmailTransport(): EmailTransportKind {
  const value = process.env.EMAIL_TRANSPORT?.trim().toLowerCase();

  if (value === 'webhook') {
    return 'webhook';
  }

  if (value === undefined || value === '') {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        'WARNING: EMAIL_TRANSPORT is not configured. Email delivery is disabled and email ' +
          'verification links cannot be sent. Set EMAIL_TRANSPORT=webhook plus EMAIL_WEBHOOK_URL ' +
          'and EMAIL_WEBHOOK_TOKEN, or EMAIL_TRANSPORT=memory to acknowledge the limitation.'
      );
    }
    return 'memory';
  }

  if (value !== 'memory') {
    console.warn(
      `WARNING: EMAIL_TRANSPORT="${value}" is not a supported transport ` +
        '(expected "memory" or "webhook"). Falling back to "memory", which delivers nothing.'
    );
  }

  return 'memory';
}

function resolveEmailFrom(): string {
  const value = process.env.EMAIL_FROM?.trim();

  if (value) {
    return value;
  }

  if (process.env.NODE_ENV === 'production') {
    console.warn(
      'WARNING: EMAIL_FROM is not configured. Verification emails would be sent from the ' +
        'development placeholder address. Set EMAIL_FROM to a sender on a domain you control.'
    );
  }

  return 'WealthHabit <no-reply@wealthhabit.local>';
}

export type TrustProxyValue = boolean | number | string[];

const TRUST_PROXY_SYMBOLIC_RANGES = new Set(['linklocal', 'loopback', 'uniquelocal']);

function warnTrustProxy(problem: string): false {
  console.warn(
    `WARNING: TRUST_PROXY ${problem}. Falling back to false so X-Forwarded-For is never trusted.`
  );
  return false;
}

function isIpv4Netmask(value: string): boolean {
  if (isIP(value) !== 4) return false;

  let mask = 0;
  for (const octet of value.split('.')) {
    mask = (mask << 8) | Number(octet);
  }
  mask >>>= 0;
  if (mask === 0) return false;

  const inverted = ~mask >>> 0;
  return (inverted & (inverted + 1)) === 0;
}

function isTrustProxyToken(token: string): boolean {
  if (TRUST_PROXY_SYMBOLIC_RANGES.has(token)) return true;

  const separator = token.indexOf('/');
  if (separator === -1) return isIP(token) !== 0;
  if (token.indexOf('/', separator + 1) !== -1) return false;

  const family = isIP(token.slice(0, separator));
  if (family === 0) return false;

  const range = token.slice(separator + 1);
  if (/^[0-9]+$/.test(range)) {
    const prefix = Number(range);
    const maxPrefix = family === 4 ? 32 : 128;
    return prefix > 0 && prefix <= maxPrefix;
  }

  return family === 4 && isIpv4Netmask(range);
}

/**
 * Resolves `TRUST_PROXY` into a value Express accepts for `app.set('trust proxy')`.
 *
 * Returns `false` (the safe default) for unset/empty input and for anything that
 * cannot be proven safe. A literal `true` is never honoured because it would let
 * any client forge `X-Forwarded-For` and rotate its own rate-limit key.
 */
export function resolveTrustProxy(
  raw: string | undefined = process.env.TRUST_PROXY
): TrustProxyValue {
  if (raw === undefined) return false;

  const value = raw.trim();
  if (value === '') return false;

  const normalized = value.toLowerCase();
  if (normalized === 'false' || normalized === '0') return false;

  if (normalized === 'true') {
    return warnTrustProxy(
      'cannot be "true"; permissive trust would let any client forge X-Forwarded-For'
    );
  }

  if (/^[0-9]+$/.test(value)) {
    const hops = Number(value);
    if (hops === 0) return false;
    if (Number.isSafeInteger(hops)) return hops;
    return warnTrustProxy(`"${value}" is not a safe hop count`);
  }

  const tokens = value.split(',').map((token) => token.trim());
  if (tokens.some((token) => token === '')) {
    return warnTrustProxy(`"${value}" contains an empty entry`);
  }
  if (tokens.some((token) => !isTrustProxyToken(token))) {
    return warnTrustProxy(
      `"${value}" is not a supported address, CIDR range or symbolic range`
    );
  }

  return tokens;
}

export const env = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || '',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  JWT_ACCESS_SECRET: validateJwtSecret(),
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  REFRESH_TOKEN_EXPIRES_DAYS: parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS || '30', 10),
  COOKIE_NAME: process.env.COOKIE_NAME || 'wh_refresh_token',
  COOKIE_SECURE: resolveCookieSecure(),
  COOKIE_SAME_SITE: (process.env.COOKIE_SAME_SITE as 'lax' | 'strict' | 'none') || 'lax',
  TRUST_PROXY: resolveTrustProxy(),
  EMAIL_TRANSPORT: resolveEmailTransport(),
  EMAIL_FROM: resolveEmailFrom(),
  EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL?.trim() || '',
  EMAIL_WEBHOOK_TOKEN: process.env.EMAIL_WEBHOOK_TOKEN?.trim() || '',
  EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: resolveBoundedInt(
    'EMAIL_VERIFICATION_TOKEN_TTL_MINUTES',
    process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES,
    24 * 60,
    5,
    30 * 24 * 60
  ),
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: resolveBoundedInt(
    'EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS',
    process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
    60,
    0,
    24 * 60 * 60
  ),
  // Password-reset links get a much shorter life than email-verification links:
  // 30 minutes matches the guidance for single-use credential-reset tokens and
  // limits the window in which a link sitting in an inbox or a proxy log is
  // useful to an attacker.
  PASSWORD_RESET_TOKEN_TTL_MINUTES: resolveBoundedInt(
    'PASSWORD_RESET_TOKEN_TTL_MINUTES',
    process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
    30,
    5,
    24 * 60
  ),
  // Per-account cooldown between reset emails. Deliberately longer than the
  // 60s verification cooldown: a reset mail is a higher-value abuse target
  // (it can be used to take over an account) and it should not be a way to
  // flood a mailbox.
  PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS: resolveBoundedInt(
    'PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS',
    process.env.PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS,
    300,
    0,
    24 * 60 * 60
  ),
  /**
   * AES-256-GCM key source for TOTP secrets stored in `user_mfa`. The actual
   * 32-byte key is `sha256(RAW)` computed in `crypto/aesGcm.ts`.
   */
  MFA_SECRET_ENCRYPTION_KEY: validateMfaEncryptionKey(),
  /**
   * Lifetime of a single-use login challenge. Long enough to enter a code
   * after the password step; short enough that a leaked challenge token is
   * useless almost immediately. In the middle of a second-factor attempt the
   * challenge is consumed on success and left to expire on failure (retries
   * are bounded by the per-challenge limiter, not by re-reading this).
   */
  MFA_CHALLENGE_TTL_MINUTES: resolveBoundedInt(
    'MFA_CHALLENGE_TTL_MINUTES',
    process.env.MFA_CHALLENGE_TTL_MINUTES,
    10,
    1,
    30
  ),
  /**
   * Lifetime of a *pending* enrollment: a `user_mfa` row with
   * `setupStartedAt` set and `enabledAt` null. If the confirming code does not
   * arrive inside this window the pending secret is refused and the user must
   * start setup again. Kept at 10 minutes; a TOTP token step is 30s, so this
   * allows a whole cycle of code entries without letting a half-finished
   * enrollment linger indefinitely.
   */
  MFA_SETUP_TTL_MINUTES: resolveBoundedInt(
    'MFA_SETUP_TTL_MINUTES',
    process.env.MFA_SETUP_TTL_MINUTES,
    10,
    1,
    1440
  ),
  /**
   * How many 30-second steps either side of the current one are accepted when
   * verifying a TOTP code. `1` is the common trade-off: it tolerates the clock
   * skew a normal device can produce and gives 3 valid codes per instant for a
   * legitimate user, while the per-challenge limiter keeps a code guesser
   * unpopular.
   */
  MFA_TOTP_WINDOW: resolveBoundedInt(
    'MFA_TOTP_WINDOW',
    process.env.MFA_TOTP_WINDOW,
    1,
    0,
    3
  ),
  /**
   * `issuer` parameter in the `otpauth://` URI the client renders into a QR
   * code. Displayed by authenticator apps next to the account.
   */
  MFA_ISSUER: (process.env.MFA_ISSUER || 'WealthHabit').trim(),
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
};