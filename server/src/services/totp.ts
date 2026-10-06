import otplib from 'otplib';
import { env } from '../config/index.js';

const { authenticator } = otplib;

/**
 * The preset `authenticator` decodes secrets with the thirty-two plugin
 * (base32) and defaults to the Google-Authenticator-compatible profile:
 * HMAC-SHA1, 6 digits, 30-second step. Those defaults are exactly what we
 * want; only the verification window comes from configuration.
 */
authenticator.options = {
  step: 30,
  window: env.MFA_TOTP_WINDOW,
};

/**
 * Secrets are 20 random bytes = 32 base32 characters (160 bits), which is the
 * size modern authenticator apps display and the common production choice —
 * stronger than otplib's 80-bit default.
 */
export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

/**
 * `otpauth://` URI the client renders into a QR code and the user scans with
 * an authenticator app. `issuer` and `account` both appear in the app's list,
 * so the account is the user's email address.
 */
export function buildOtpauthUri(account: string, issuer: string, secret: string): string {
  return authenticator.keyuri(account, issuer, secret);
}

/**
 * Verifies a 6-digit TOTP code against a secret, tolerating
 * `MFA_TOTP_WINDOW` 30-second steps on either side of the current one.
 */
export function verifyTotpCode(code: string, secret: string): boolean {
  if (!/^[0-9]{6}$/.test(code)) {
    return false;
  }
  return authenticator.verify({ token: code, secret });
}