import { describe, expect, it } from 'vitest';
import express from 'express';
import helmet, { type HelmetOptions } from 'helmet';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/index.js';
import {
  HSTS_MAX_AGE_SECONDS,
  buildContentSecurityPolicyDirectives,
  buildSecurityHeaderOptions,
  buildStrictTransportSecurityOption,
} from '../src/config/securityHeaders.js';

const ALLOWED_ORIGIN = env.CLIENT_URL;
const FOREIGN_ORIGIN = 'https://evil.example';
const HEALTH_PATH = '/api/health';
const ADMIN_PATH = '/api/admin/dashboard';

async function respondWith(options: HelmetOptions): Promise<request.Response> {
  const instance = express();
  instance.use(helmet(options));
  instance.get('/probe', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return request(instance).get('/probe');
}

describe('security headers', () => {
  describe('normal API response', () => {
    it('sets X-Content-Type-Options to nosniff', async () => {
      const response = await request(app).get(HEALTH_PATH);

      expect(response.status).toBe(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets X-Frame-Options', async () => {
      const response = await request(app).get(HEALTH_PATH);

      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('sets Referrer-Policy', async () => {
      const response = await request(app).get(HEALTH_PATH);

      expect(response.headers['referrer-policy']).toBe('no-referrer');
    });

    it('never exposes X-Powered-By', async () => {
      const response = await request(app).get(HEALTH_PATH);

      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('keeps the remaining helmet headers pinned', async () => {
      const response = await request(app).get(HEALTH_PATH);

      expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(response.headers['origin-agent-cluster']).toBe('?1');
      expect(response.headers['x-dns-prefetch-control']).toBe('off');
      expect(response.headers['x-download-options']).toBe('noopen');
      expect(response.headers['x-permitted-cross-domain-policies']).toBe('none');
      expect(response.headers['x-xss-protection']).toBe('0');
      expect(response.headers['cross-origin-embedder-policy']).toBeUndefined();
    });
  });

  describe('Content-Security-Policy', () => {
    it('sets a CSP on normal API responses', async () => {
      const response = await request(app).get(HEALTH_PATH);
      const csp = response.headers['content-security-policy'];

      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("script-src-attr 'none'");
      expect(csp).toContain("img-src 'self' data:");
      expect(csp).toContain("font-src 'self' https: data:");
      expect(csp).toContain("style-src 'self' https: 'unsafe-inline'");
    });

    it('does not apply the production CSP outside production', async () => {
      expect(env.isProduction).toBe(false);

      const response = await request(app).get(HEALTH_PATH);

      expect(response.headers['content-security-policy']).not.toContain(
        'upgrade-insecure-requests'
      );
    });

    it('adds upgrade-insecure-requests to the production directive set', () => {
      const production = buildContentSecurityPolicyDirectives(true);
      const development = buildContentSecurityPolicyDirectives(false);

      expect(production['upgrade-insecure-requests']).toEqual([]);
      expect(development['upgrade-insecure-requests']).toBeUndefined();
    });

    it('pins an explicit directive set instead of using helmet defaults', () => {
      expect(buildSecurityHeaderOptions(false).contentSecurityPolicy).toEqual({
        useDefaults: false,
        directives: buildContentSecurityPolicyDirectives(false),
      });
      expect(buildSecurityHeaderOptions(true).contentSecurityPolicy).toEqual({
        useDefaults: false,
        directives: buildContentSecurityPolicyDirectives(true),
      });
    });
  });

  describe('Strict-Transport-Security', () => {
    it('never sends HSTS outside production', async () => {
      expect(env.isProduction).toBe(false);

      const response = await request(app).get(HEALTH_PATH);

      expect(response.headers['strict-transport-security']).toBeUndefined();
    });

    it('enables HSTS only in production', () => {
      expect(buildStrictTransportSecurityOption(false)).toBe(false);
      expect(buildStrictTransportSecurityOption(true)).toEqual({
        maxAge: HSTS_MAX_AGE_SECONDS,
        includeSubDomains: true,
      });
    });

    it('applies the production HSTS option to the built helmet options', () => {
      expect(buildSecurityHeaderOptions(false).strictTransportSecurity).toBe(false);
      expect(buildSecurityHeaderOptions(true).strictTransportSecurity).toEqual({
        maxAge: 15552000,
        includeSubDomains: true,
      });
    });
  });

  describe('admin API responses', () => {
    it('sets the same security headers on /api/admin/* responses', async () => {
      const response = await request(app).get(ADMIN_PATH);

      expect(response.status).toBe(401);
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['strict-transport-security']).toBeUndefined();
    });

    it('never exposes X-Powered-By on admin responses', async () => {
      const response = await request(app).get(ADMIN_PATH);

      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });
});

describe('helmet configuration per environment', () => {
  it('emits the production header set in production', async () => {
    const response = await respondWith(buildSecurityHeaderOptions(true));

    expect(response.status).toBe(200);
    expect(response.headers['strict-transport-security']).toBe(
      'max-age=15552000; includeSubDomains'
    );
    expect(response.headers['content-security-policy']).toContain(
      'upgrade-insecure-requests'
    );
    expect(response.headers['content-security-policy']).toContain(
      "object-src 'none'"
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('omits HSTS and upgrade-insecure-requests outside production', async () => {
    const response = await respondWith(buildSecurityHeaderOptions(false));

    expect(response.status).toBe(200);
    expect(response.headers['strict-transport-security']).toBeUndefined();
    expect(response.headers['content-security-policy']).not.toContain(
      'upgrade-insecure-requests'
    );
    expect(response.headers['content-security-policy']).toContain(
      "object-src 'none'"
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  describe('preflight for the configured CLIENT_URL', () => {
    it('grants the configured origin', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    });

    it('allows credentials', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('only allows the configured request headers', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type,Authorization');

      expect(response.headers['access-control-allow-headers']).toBe(
        'Content-Type,Authorization'
      );
    });

    it('only allows the configured methods', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-allow-methods']).toBe(
        'GET,POST,PUT,PATCH,DELETE,OPTIONS'
      );
    });

    it('varies on Origin', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['vary']).toContain('Origin');
    });

    it('caches the preflight result so bursts do not repeat OPTIONS calls', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-max-age']).toBe('600');
    });
  });

  describe('foreign origin', () => {
    it('does not grant preflight access to a foreign origin', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', FOREIGN_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not reflect a foreign origin on actual responses', async () => {
      const response = await request(app)
        .get(HEALTH_PATH)
        .set('Origin', FOREIGN_ORIGIN);

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('actual responses', () => {
    it('grants the configured origin with credentials', async () => {
      const response = await request(app)
        .get(HEALTH_PATH)
        .set('Origin', ALLOWED_ORIGIN);

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not send an allow-origin header without a request origin', async () => {
      const response = await request(app).get(HEALTH_PATH);

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});

describe('cache control', () => {
  it('marks API responses private and non-cacheable', async () => {
    const response = await request(app).get(HEALTH_PATH);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('marks error responses non-cacheable too', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
});

describe('request body limits', () => {
  it('rejects an oversized body with 413 instead of a 500', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'body-limit@example.com', password: 'x'.repeat(110 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Request body too large');
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON with 400 instead of a 500', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Invalid request body');
  });
});
