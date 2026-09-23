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
});