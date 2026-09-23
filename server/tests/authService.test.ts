import { describe, it, expect, vi } from 'vitest';
import { authService } from '../src/services/authService.js';
import { env } from '../src/config/index.js';

describe('Auth Service', () => {
  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const password = 'StrongPassword123!';
      const hash = await authService.hashPassword(password);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50);
    });

    it('should generate different hashes for same password', async () => {
      const password = 'StrongPassword123!';
      const hash1 = await authService.hashPassword(password);
      const hash2 = await authService.hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const password = 'StrongPassword123!';
      const hash = await authService.hashPassword(password);
      const valid = await authService.verifyPassword(hash, password);

      expect(valid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'StrongPassword123!';
      const hash = await authService.hashPassword(password);
      const valid = await authService.verifyPassword(hash, 'WrongPassword123!');

      expect(valid).toBe(false);
    });

    it('should reject empty password', async () => {
      const password = 'StrongPassword123!';
      const hash = await authService.hashPassword(password);
      const valid = await authService.verifyPassword(hash, '');

      expect(valid).toBe(false);
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a random token', () => {
      const token1 = authService.generateRefreshToken();
      const token2 = authService.generateRefreshToken();

      expect(token1).toBeDefined();
      expect(typeof token1).toBe('string');
      expect(token1.length).toBe(128);
      expect(token1).not.toBe(token2);
    });
  });

  describe('hashRefreshToken', () => {
    it('should hash a token consistently', () => {
      const token = 'test-refresh-token';
      const hash1 = authService.hashRefreshToken(token);
      const hash2 = authService.hashRefreshToken(token);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });

    it('should produce different hashes for different tokens', () => {
      const hash1 = authService.hashRefreshToken('token1');
      const hash2 = authService.hashRefreshToken('token2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('cookie configuration validation', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should allow SameSite=lax with Secure=false', async () => {
      process.env.COOKIE_SAME_SITE = 'lax';
      process.env.COOKIE_SECURE = 'false';
      process.env.NODE_ENV = 'development';

      const { authService: freshAuthService } = await import('../src/services/authService.js');
      const res = { cookie: vi.fn() } as any;

      expect(() => freshAuthService.setRefreshCookie(res, 'test-token')).not.toThrow();
    });

    it('should allow SameSite=none with Secure=true', async () => {
      process.env.COOKIE_SAME_SITE = 'none';
      process.env.COOKIE_SECURE = 'true';
      process.env.NODE_ENV = 'development';

      const { authService: freshAuthService } = await import('../src/services/authService.js');
      const res = { cookie: vi.fn() } as any;

      expect(() => freshAuthService.setRefreshCookie(res, 'test-token')).not.toThrow();
    });

    it('should reject SameSite=none with Secure=false', async () => {
      process.env.COOKIE_SAME_SITE = 'none';
      process.env.COOKIE_SECURE = 'false';
      process.env.NODE_ENV = 'development';

      const { authService: freshAuthService } = await import('../src/services/authService.js');
      const res = { cookie: vi.fn() } as any;

      expect(() => freshAuthService.setRefreshCookie(res, 'test-token')).toThrow(
        'SameSite=None requires Secure=true'
      );
    });
  });
});