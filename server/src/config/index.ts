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
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
};