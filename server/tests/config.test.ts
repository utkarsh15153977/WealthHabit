import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reads a tracked `KEY=value` style template file. Used to assert the contract
 * of `server/.env.production.example` itself, so the shipped template cannot
 * silently drift back to a value the runtime is supposed to reject.
 */
function readTemplate(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

function templateValue(contents: string, key: string): string {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(new RegExp(`^${key}=(.*)$`));
    if (match) return match[1].trim();
  }
  throw new Error(`${key} is not defined in the template`);
}

/** Assigned values only, with the file's explanatory comments removed. */
function templateAssignments(contents: string): string {
  return contents
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/**
 * Test-only stand-in for real signing material. Generated-shaped (base64url
 * alphabet, high entropy) so it exercises the "sufficiently random long secret"
 * path. It is not a secret and must never be used outside tests.
 */
const GENERATED_LOOKING_SECRET = 'k3JtQ8vXpZ1sWn7bYd4LhR2tF6jG0uC9aM5eI3oV8xQ1zN7c';

/**
 * Test-only stand-in for the configured MFA AES encryption key material.
 * Generated-shaped (base64url alphabet, high entropy, well over 32
 * characters) so it exercises the "sufficiently random long key" path without
 * tripping the placeholder or minimum-length rules. It is not a secret and
 * must never be used outside tests.
 */
const GENERATED_LOOKING_MFA_KEY = 'M7kPq2vXcN8wRtY5bH3jL0zF6dS9aG1uE4iK6oP2wV8cX4bD';

describe('Config Validation', () => {
  const originalEnv = { ...process.env };

  /**
   * `MFA_SECRET_ENCRYPTION_KEY` is required in production (fail-closed, like
   * `JWT_ACCESS_SECRET`). Tests below that simulate `NODE_ENV=production` to
   * exercise some *other* setting must therefore provide a valid key or the
   * config module aborts before the assertion under test runs. Seeding a
   * deterministic, test-only value here makes that the default so unrelated
   * production-simulation tests pass, while the MFA-specific tests below still
   * delete/replace the variable to assert the real fail-closed behaviour.
   */
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.MFA_SECRET_ENCRYPTION_KEY = GENERATED_LOOKING_MFA_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('JWT_ACCESS_SECRET validation', () => {
    it('should use development fallback when not set in development', async () => {
      delete process.env.JWT_ACCESS_SECRET;
      process.env.NODE_ENV = 'development';

      const { env } = await import('../src/config/index.js');
      expect(env.JWT_ACCESS_SECRET).toBe('dev-secret-change-in-production');
    });

    it('should throw when not set in production', async () => {
      delete process.env.JWT_ACCESS_SECRET;
      process.env.NODE_ENV = 'production';

      await expect(import('../src/config/index.js')).rejects.toThrow(
        'JWT_ACCESS_SECRET must be set in production'
      );
    });

    it('should throw when too short in production', async () => {
      process.env.JWT_ACCESS_SECRET = 'short';
      process.env.NODE_ENV = 'production';

      await expect(import('../src/config/index.js')).rejects.toThrow(
        'JWT_ACCESS_SECRET must be at least 32 characters in production'
      );
    });

    it('should throw when using dev default in production', async () => {
      process.env.JWT_ACCESS_SECRET = 'dev-secret-change-in-production';
      process.env.NODE_ENV = 'production';

      await expect(import('../src/config/index.js')).rejects.toThrow(
        'JWT_ACCESS_SECRET cannot be the default development value in production'
      );
    });

    it('should accept valid secret in production', async () => {
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
      process.env.NODE_ENV = 'production';

      const { env } = await import('../src/config/index.js');
      expect(env.JWT_ACCESS_SECRET).toBe('a'.repeat(32));
    });

    it('should warn but accept short secret in development', async () => {
      process.env.JWT_ACCESS_SECRET = 'short';
      process.env.NODE_ENV = 'development';

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await import('../src/config/index.js');
      expect(env.JWT_ACCESS_SECRET).toBe('short');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('JWT_ACCESS_SECRET is less than 32 characters')
      );
      consoleWarnSpy.mockRestore();
    });

    it('should throw in production for the placeholder shipped in .env.production.example', async () => {
      const template = readTemplate('../.env.production.example');
      const placeholder = templateValue(template, 'JWT_ACCESS_SECRET');

      // Sanity-check that this test is actually exercising a placeholder that is
      // long enough to satisfy the minimum-length rule. Without this guard the
      // length check would mask a regression in the placeholder check.
      expect(placeholder.length).toBeGreaterThanOrEqual(32);

      process.env.JWT_ACCESS_SECRET = placeholder;
      process.env.NODE_ENV = 'production';

      await expect(import('../src/config/index.js')).rejects.toThrow(
        'JWT_ACCESS_SECRET is still the placeholder value from server/.env.production.example'
      );
    });

    it('should reject near-variants of the published placeholder in production', async () => {
      process.env.NODE_ENV = 'production';

      for (const variant of [
        'REPLACE-WITH-AT-LEAST-32-RANDOM-CHARACTERS-FROM-A-SECRET-STORE',
        '  replace-with-at-least-32-random-characters-from-a-secret-store  ',
        'replace_with_at_least_32_random_characters_from_a_secret_store',
        'replace-with-some-other-long-placeholder-value-here',
        'change-me-before-production-please-0123456789',
      ]) {
        vi.resetModules();
        process.env.JWT_ACCESS_SECRET = variant;

        await expect(import('../src/config/index.js')).rejects.toThrow(
          'JWT_ACCESS_SECRET is still the placeholder value'
        );
      }
    });

    it('should warn but accept a placeholder in development', async () => {
      process.env.JWT_ACCESS_SECRET =
        'replace-with-at-least-32-random-characters-from-a-secret-store';
      process.env.NODE_ENV = 'development';

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await import('../src/config/index.js');

      expect(env.JWT_ACCESS_SECRET).toBe(
        'replace-with-at-least-32-random-characters-from-a-secret-store'
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('JWT_ACCESS_SECRET looks like a template placeholder')
      );
      consoleWarnSpy.mockRestore();
    });

    it('should accept a sufficiently random long secret in production', async () => {
      process.env.JWT_ACCESS_SECRET = GENERATED_LOOKING_SECRET;
      process.env.NODE_ENV = 'production';

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await import('../src/config/index.js');

      expect(env.JWT_ACCESS_SECRET).toBe(GENERATED_LOOKING_SECRET);
      // A real generated secret must not be flagged by any JWT-related rule.
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('JWT_ACCESS_SECRET')
      );
      consoleWarnSpy.mockRestore();
    });

    it('should reject a short placeholder with the placeholder error, not the length error', async () => {
      process.env.JWT_ACCESS_SECRET = 'replace-with-me';
      process.env.NODE_ENV = 'production';

      // The placeholder check runs first so the operator gets the actionable
      // message regardless of how short the placeholder happens to be.
      await expect(import('../src/config/index.js')).rejects.toThrow(
        'JWT_ACCESS_SECRET is still the placeholder value'
      );
    });
  });

  describe('MFA_SECRET_ENCRYPTION_KEY validation', () => {
    it('should use development fallback when not set in development', async () => {
      delete process.env.MFA_SECRET_ENCRYPTION_KEY;
      process.env.NODE_ENV = 'development';

      const { env } = await import('../src/config/index.js');
      expect(env.MFA_SECRET_ENCRYPTION_KEY).toBe(
        'dev-mfa-encryption-key-change-in-production'
      );
    });

    it('should throw when not set in production', async () => {
      delete process.env.MFA_SECRET_ENCRYPTION_KEY;
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
      process.env.NODE_ENV = 'production';

      await expect(import('../src/config/index.js')).rejects.toThrow(
        'MFA_SECRET_ENCRYPTION_KEY must be set in production'
      );
    });

    it('should throw when too short in production', async () => {
      process.env.MFA_SECRET_ENCRYPTION_KEY = 'short';
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
      process.env.NODE_ENV = 'production';

      await expect(import('../src/config/index.js')).rejects.toThrow(
        'MFA_SECRET_ENCRYPTION_KEY must be at least 32 characters in production'
      );
    });

    it('should throw when using dev default in production', async () => {
      process.env.MFA_SECRET_ENCRYPTION_KEY =
        'dev-mfa-encryption-key-change-in-production';
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
      process.env.NODE_ENV = 'production';

      await expect(import('../src/config/index.js')).rejects.toThrow(
        'MFA_SECRET_ENCRYPTION_KEY cannot be the default development value in production'
      );
    });

    it('should accept a valid key in production', async () => {
      process.env.JWT_ACCESS_SECRET = GENERATED_LOOKING_SECRET;
      process.env.NODE_ENV = 'production';

      const { env } = await import('../src/config/index.js');
      expect(env.MFA_SECRET_ENCRYPTION_KEY).toBe(GENERATED_LOOKING_MFA_KEY);
    });

    it('should warn but accept a short key in development', async () => {
      process.env.MFA_SECRET_ENCRYPTION_KEY = 'short';
      process.env.NODE_ENV = 'development';

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await import('../src/config/index.js');
      expect(env.MFA_SECRET_ENCRYPTION_KEY).toBe('short');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('MFA_SECRET_ENCRYPTION_KEY is less than 32 characters')
      );
      consoleWarnSpy.mockRestore();
    });

    it('should throw in production for the placeholder shipped in .env.production.example', async () => {
      const template = readTemplate('../.env.production.example');
      const placeholder = templateValue(template, 'MFA_SECRET_ENCRYPTION_KEY');

      // Same sanity guard as the JWT contract test: the placeholder must be long
      // enough that only the placeholder check (not the length check) can reject it.
      expect(placeholder.length).toBeGreaterThanOrEqual(32);

      process.env.MFA_SECRET_ENCRYPTION_KEY = placeholder;
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
      process.env.NODE_ENV = 'production';

      await expect(import('../src/config/index.js')).rejects.toThrow(
        'MFA_SECRET_ENCRYPTION_KEY is still the placeholder value from server/.env.production.example'
      );
    });

    it('should reject near-variants of the published MFA placeholder in production', async () => {
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
      process.env.NODE_ENV = 'production';

      for (const variant of [
        'REPLACE-WITH-AT-LEAST-32-RANDOM-CHARACTERS-FROM-A-SECRET-STORE',
        '  replace-with-at-least-32-random-characters-from-a-secret-store  ',
        'replace_with_at_least_32_random_characters_from_a_secret_store',
        'replace-with-some-other-long-placeholder-value-here',
        'change-me-before-production-please-0123456789',
        'your-mfa-secret-must-be-replaced-before-production-1234',
      ]) {
        vi.resetModules();
        process.env.MFA_SECRET_ENCRYPTION_KEY = variant;

        await expect(import('../src/config/index.js')).rejects.toThrow(
          'MFA_SECRET_ENCRYPTION_KEY is still the placeholder value'
        );
      }
    });

    it('should warn but accept a placeholder in development', async () => {
      process.env.MFA_SECRET_ENCRYPTION_KEY =
        'replace-with-at-least-32-random-characters-from-a-secret-store';
      process.env.NODE_ENV = 'development';

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await import('../src/config/index.js');

      expect(env.MFA_SECRET_ENCRYPTION_KEY).toBe(
        'replace-with-at-least-32-random-characters-from-a-secret-store'
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('MFA_SECRET_ENCRYPTION_KEY looks like a template placeholder')
      );
      consoleWarnSpy.mockRestore();
    });

    it('should accept a sufficiently random long key in production', async () => {
      process.env.JWT_ACCESS_SECRET = GENERATED_LOOKING_SECRET;
      process.env.NODE_ENV = 'production';

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await import('../src/config/index.js');

      expect(env.MFA_SECRET_ENCRYPTION_KEY).toBe(GENERATED_LOOKING_MFA_KEY);
      // A real generated key must not be flagged by any MFA-related rule.
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('MFA_SECRET_ENCRYPTION_KEY')
      );
      consoleWarnSpy.mockRestore();
    });

    it('should reject a short placeholder with the placeholder error, not the length error', async () => {
      process.env.MFA_SECRET_ENCRYPTION_KEY = 'replace-with-me';
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
      process.env.NODE_ENV = 'production';

      // The placeholder check runs first so the operator gets the actionable
      // message regardless of how short the placeholder happens to be.
      await expect(import('../src/config/index.js')).rejects.toThrow(
        'MFA_SECRET_ENCRYPTION_KEY is still the placeholder value'
      );
    });
  });

  describe('SEC-002 production example contract', () => {
    it('keeps the shipped JWT placeholder rejectable and free of usable secrets', () => {
      const template = readTemplate('../.env.production.example');
      const assigned = templateAssignments(template);

      // The template must still carry a placeholder (it is documentation, not a
      // secret store) and must never carry real signing material. Only assigned
      // values are inspected: the file's comments legitimately *name* the
      // development values it tells operators never to reuse.
      expect(template).toContain('JWT_ACCESS_SECRET=replace-with-');
      expect(assigned).not.toContain('dev-secret-change-in-production');
      expect(assigned).not.toMatch(/localhost:5433/);
      expect(assigned).not.toMatch(/rds\.amazonaws\.com/);
    });
  });

  describe('COOKIE_SECURE validation', () => {
    it('keeps cookies insecure by default in development', async () => {
      delete process.env.COOKIE_SECURE;
      process.env.NODE_ENV = 'development';

      const { env } = await import('../src/config/index.js');
      expect(env.COOKIE_SECURE).toBe(false);
    });

    it('honours an explicit secure cookie opt-in in development', async () => {
      process.env.COOKIE_SECURE = 'true';
      process.env.NODE_ENV = 'development';

      const { env } = await import('../src/config/index.js');
      expect(env.COOKIE_SECURE).toBe(true);
    });

    it('forces secure cookies in production when unset', async () => {
      delete process.env.COOKIE_SECURE;
      process.env.NODE_ENV = 'production';
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await import('../src/config/index.js');

      expect(env.COOKIE_SECURE).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('COOKIE_SECURE is not enabled but NODE_ENV=production')
      );
      consoleWarnSpy.mockRestore();
    });

    it('refuses an explicit COOKIE_SECURE=false in production', async () => {
      process.env.COOKIE_SECURE = 'false';
      process.env.NODE_ENV = 'production';
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await import('../src/config/index.js');

      expect(env.COOKIE_SECURE).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('COOKIE_SECURE is not enabled but NODE_ENV=production')
      );
      consoleWarnSpy.mockRestore();
    });

    it('keeps an explicit COOKIE_SECURE=true in production without warning', async () => {
      process.env.COOKIE_SECURE = 'true';
      process.env.NODE_ENV = 'production';
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await import('../src/config/index.js');

      expect(env.COOKIE_SECURE).toBe(true);
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('COOKIE_SECURE is not enabled')
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe('TRUST_PROXY validation', () => {
    async function loadEnv(value: string | undefined) {
      if (value === undefined) {
        delete process.env.TRUST_PROXY;
      } else {
        process.env.TRUST_PROXY = value;
      }

      vi.resetModules();
      const loaded = await import('../src/config/index.js');
      return { env: loaded.env, resolveTrustProxy: loaded.resolveTrustProxy };
    }

    it('defaults to false when TRUST_PROXY is unset', async () => {
      const { env } = await loadEnv(undefined);

      expect(env.TRUST_PROXY).toBe(false);
    });

    it('defaults to false when TRUST_PROXY is blank', async () => {
      const { env } = await loadEnv('   ');

      expect(env.TRUST_PROXY).toBe(false);
    });

    it('keeps an explicit false as false without warning', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await loadEnv('false');

      expect(env.TRUST_PROXY).toBe(false);
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('TRUST_PROXY')
      );
      consoleWarnSpy.mockRestore();
    });

    it('accepts a safe positive integer hop count', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await loadEnv('1');

      expect(env.TRUST_PROXY).toBe(1);
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('TRUST_PROXY')
      );

      const second = await loadEnv('3');
      expect(second.env.TRUST_PROXY).toBe(3);
      consoleWarnSpy.mockRestore();
    });

    it('accepts a proxy-addr symbolic range', async () => {
      const { env } = await loadEnv('loopback');

      expect(env.TRUST_PROXY).toEqual(['loopback']);
    });

    it('accepts a CIDR list with mixed spacing', async () => {
      const { env } = await loadEnv('10.0.0.0/8, uniquelocal');

      expect(env.TRUST_PROXY).toEqual(['10.0.0.0/8', 'uniquelocal']);
    });

    it('fails closed to false for an invalid value with a warning', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await loadEnv('definitely-not-a-proxy');

      expect(env.TRUST_PROXY).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('TRUST_PROXY')
      );
      consoleWarnSpy.mockRestore();
    });

    it('never activates permissive trust from a literal true', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env, resolveTrustProxy } = await loadEnv('true');

      expect(env.TRUST_PROXY).toBe(false);
      expect(resolveTrustProxy('true')).toBe(false);
      expect(resolveTrustProxy('TRUE')).toBe(false);
      expect(resolveTrustProxy('True')).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('TRUST_PROXY')
      );
      consoleWarnSpy.mockRestore();
    });

    it('rejects non-integer, negative and empty-entry values', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env, resolveTrustProxy } = await loadEnv(undefined);

      for (const bad of ['2.5', '-1', 'yes', 'on', 'loopback,']) {
        expect(resolveTrustProxy(bad)).toBe(false);
      }
      expect(env.TRUST_PROXY).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('TRUST_PROXY')
      );
      consoleWarnSpy.mockRestore();
    });

    it('rejects an out-of-range or non-contiguous range', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { resolveTrustProxy } = await loadEnv(undefined);

      expect(resolveTrustProxy('10.0.0.0/0')).toBe(false);
      expect(resolveTrustProxy('10.0.0.0/33')).toBe(false);
      expect(resolveTrustProxy('2001:db8::/129')).toBe(false);
      expect(resolveTrustProxy('10.0.0.0/255.0.255.0')).toBe(false);
      consoleWarnSpy.mockRestore();
    });

    it('treats an explicit 0 as false without a warning', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await loadEnv('0');

      expect(env.TRUST_PROXY).toBe(false);
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('TRUST_PROXY')
      );
      consoleWarnSpy.mockRestore();
    });

    it('stays false in production when unset', async () => {
      delete process.env.TRUST_PROXY;
      process.env.NODE_ENV = 'production';
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);

      vi.resetModules();
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { env } = await import('../src/config/index.js');

      expect(env.TRUST_PROXY).toBe(false);
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('TRUST_PROXY')
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe('SEC-001 production example contract', () => {
    it('declares exactly one trusted hop, matching the shipped nginx topology', async () => {
      const template = readTemplate('../.env.production.example');
      const declared = templateValue(template, 'TRUST_PROXY');

      // docker-compose.production.yml publishes only the client nginx and keeps
      // the API internal, so the API always sits behind exactly one proxy hop.
      expect(declared).toBe('1');

      const { resolveTrustProxy } = await import('../src/config/index.js');
      expect(resolveTrustProxy(declared)).toBe(1);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(resolveTrustProxy(declared)).toBe(1);
      // A correct hop count must not be silently downgraded to the safe default.
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('TRUST_PROXY')
      );
      consoleWarnSpy.mockRestore();
    });

    it('does not ship a value that would collapse rate-limit keys', async () => {
      const template = readTemplate('../.env.production.example');
      const declared = templateValue(template, 'TRUST_PROXY');
      const { resolveTrustProxy } = await import('../src/config/index.js');

      // The regression this guards: TRUST_PROXY=false shipped in the template
      // while the API always sits behind one nginx hop.
      expect(resolveTrustProxy(declared)).not.toBe(false);
    });
  });
});