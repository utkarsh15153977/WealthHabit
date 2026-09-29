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
});