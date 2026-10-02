import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Config Validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
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
});