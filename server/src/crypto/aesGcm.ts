import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * One-time derivation of the 32-byte AES key from the raw configuration value.
 * The config resolver guarantees a sane raw value per environment; hashing it
 * to exactly 32 bytes makes any operator-supplied string a valid key material
 * source without accepting variable-length keys.
 */
let cachedKey: Buffer | null = null;

function aesKey(): Buffer {
  if (cachedKey === null) {
    cachedKey = createHash('sha256').update(env.MFA_SECRET_ENCRYPTION_KEY).digest();
  }
  return cachedKey;
}

/**
 * Encrypts a TOTP secret for storage in `user_mfa.secretEncrypted`.
 *
 * AES-256-GCM over a versioned envelope: `v1.<base64(iv + ciphertext + tag)>`.
 * The tag authenticates the ciphertext, so a tampered or truncated stored
 * value fails `decryptTOTPSecret` below rather than decrypting to garbage. A
 * fresh random 96-bit IV is used per encryption; GCM IV reuse is the one
 * catastrophic failure mode, so the IV is never reused across calls.
 */
export function encryptTOTPSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, aesKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, ciphertext, tag]).toString('base64')}`;
}

/**
 * Decrypts a value produced by {@link encryptTOTPSecret}.
 *
 * Throws on any malformed envelope, wrong version, or authentication failure —
 * there is intentionally no "best effort" fallback, so a corrupted database row
 * becomes a hard error the operator must inspect rather than a silently wrong
 * TOTP secret that breaks login for the account.
 */
export function decryptTOTPSecret(envelope: string): string {
  if (!envelope.startsWith('v1.')) {
    throw new Error('Unsupported TOTP secret envelope version');
  }

  const raw = Buffer.from(envelope.slice(3), 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Malformed TOTP secret envelope');
  }

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, aesKey(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}