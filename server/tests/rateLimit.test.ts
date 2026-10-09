import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ipKeyGenerator } from 'express-rate-limit';
import app from '../src/app.js';
import { env } from '../src/config/index.js';
import {
  apiRateLimit,
  authRateLimit,
  buildLoginRateLimitKey,
  buildScopedRateLimitKey,
  loginRateLimit,
  RESEND_VERIFICATION_RATE_LIMIT_MAX,
  resendVerificationRateLimit,
  forgotPasswordRateLimit,
  resetPasswordRateLimit,
  FORGOT_PASSWORD_RATE_LIMIT_MAX,
  RESET_PASSWORD_RATE_LIMIT_MAX,
  healthReadinessRateLimit,
  HEALTH_READINESS_RATE_LIMIT_MAX,
} from '../src/middleware/rateLimit.js';

const API_LIMIT = String(env.isDevelopment ? 500 : 100);
const AUTH_LIMIT = String(env.isDevelopment ? 100 : 20);
const RESEND_LIMIT = RESEND_VERIFICATION_RATE_LIMIT_MAX;
const FORGOT_LIMIT = FORGOT_PASSWORD_RATE_LIMIT_MAX;
const RESET_LIMIT = RESET_PASSWORD_RATE_LIMIT_MAX;

const CLIENT_KEYS = ['127.0.0.1', '::1'].map((ip) => ipKeyGenerator(ip, 56));
const NEVER_SEEN_KEY = ipKeyGenerator('203.0.113.200', 56);

type CountingLimiter = {
  getKey: (
    key: string
  ) => Promise<{ totalHits: number } | undefined> | { totalHits: number } | undefined;
};

async function countedKey(limiter: CountingLimiter): Promise<string | undefined> {
  for (const key of CLIENT_KEYS) {
    if (await limiter.getKey(key)) return key;
  }
  return undefined;
}

async function resetClientCounters(): Promise<void> {
  for (const key of CLIENT_KEYS) {
    authRateLimit.resetKey(key);
    // Login requests without an email use the IP-only fallback key.
    loginRateLimit.resetKey(buildLoginRateLimitKey(undefined, key));
    apiRateLimit.resetKey(key);
  }
}

describe('API rate limiting', () => {
  it('exempts health checks from rate limiting', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['ratelimit-limit']).toBeUndefined();
  });

  it('applies the general API limiter to protected routes', async () => {
    const response = await request(app).get('/api/dashboard/summary');

    expect(response.headers['ratelimit-limit']).toBe(API_LIMIT);
  });

  it('keeps the stricter auth limiter on public auth routes', async () => {
    const response = await request(app).post('/api/auth/login').send({});

    expect(response.headers['ratelimit-limit']).toBe(AUTH_LIMIT);
  });

  it('applies the auth limiter to logout', async () => {
    const response = await request(app).post('/api/auth/logout').send({});

    expect(response.headers['ratelimit-limit']).toBe(AUTH_LIMIT);
  });

  it('applies the auth limiter to logout-all', async () => {
    const response = await request(app).post('/api/auth/logout-all').send({});

    expect(response.headers['ratelimit-limit']).toBe(AUTH_LIMIT);
  });

  it('applies the auth limiter to the current-user endpoint', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.headers['ratelimit-limit']).toBe(AUTH_LIMIT);
  });

  it('applies the auth limiter to register', async () => {
    const response = await request(app).post('/api/auth/register').send({});

    expect(response.headers['ratelimit-limit']).toBe(AUTH_LIMIT);
  });

  it('applies the auth limiter to refresh', async () => {
    const response = await request(app).post('/api/auth/refresh').send({});

    expect(response.headers['ratelimit-limit']).toBe(AUTH_LIMIT);
  });

  it('applies the auth limiter to verify-email', async () => {
    const response = await request(app).post('/api/auth/verify-email').send({});

    expect(response.headers['ratelimit-limit']).toBe(AUTH_LIMIT);
  });

  it('enforces the tighter resend budget before the general auth budget', async () => {
    const email = `budget-${Date.now()}@example.com`;

    // The `RateLimit-Limit` header reports the general auth limiter (20/100)
    // because both limiters run and the last one writes the header, so the
    // tighter per-account budget is verified by behaviour instead: 21 attempts
    // must trip it long before the 100-request general budget is reached.
    let limited: request.Response | undefined;

    for (let i = 0; i <= RESEND_LIMIT; i++) {
      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited).toBeDefined();
    expect(limited!.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('returns a RATE_LIMIT_EXCEEDED error payload when limited', async () => {
    let limited: request.Response | undefined;

    for (let i = 0; i <= Number(AUTH_LIMIT); i++) {
      const response = await request(app).post('/api/auth/login').send({});
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited).toBeDefined();
    expect(limited!.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('enforces the forgot-password budget on (account, IP) before the general budget', async () => {
    const email = `forgot-budget-${Date.now()}@example.com`;
    let limited: request.Response | undefined;

    for (let i = 0; i <= FORGOT_LIMIT; i++) {
      const response = await request(app).post('/api/auth/forgot-password').send({ email });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited).toBeDefined();
    expect(limited!.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('enforces the reset-password budget before the handler runs', async () => {
    let limited: request.Response | undefined;

    for (let i = 0; i <= RESET_LIMIT; i++) {
      const response = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'a'.repeat(64), newPassword: 'ValidPassword123!' });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited).toBeDefined();
    expect(limited!.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

describe('password-reset limiter separation', () => {
  it('spends the forgot-password budget identically for real and unknown addresses', async () => {
    const key = buildScopedRateLimitKey(
      'forgot-password',
      'ghost@example.com',
      ipKeyGenerator('127.0.0.1', 56)
    );

    // An address that does not exist still increments the counter, which is
    // what stops a 429 from revealing whether an address is registered.
    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'ghost@example.com' });
    const real = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'ghost@example.com' });

    expect(unknown.status).toBe(real.status);
    expect((await forgotPasswordRateLimit.getKey(key))?.totalHits).toBe(2);

    forgotPasswordRateLimit.resetKey(key);
  });

  it('normalizes the address so casing variants share one budget', async () => {
    const email = `forgot-casing-${Date.now()}@example.com`;
    const key = buildScopedRateLimitKey(
      'forgot-password',
      email,
      ipKeyGenerator('127.0.0.1', 56)
    );

    await request(app).post('/api/auth/forgot-password').send({ email });
    await request(app).post('/api/auth/forgot-password').send({ email: email.toUpperCase() });

    expect((await forgotPasswordRateLimit.getKey(key))?.totalHits).toBe(2);

    forgotPasswordRateLimit.resetKey(key);
  });

  it('keys the reset limiter on the client IP alone, never on the token', async () => {
    const clientKey = ipKeyGenerator('127.0.0.1', 56);
    resetPasswordRateLimit.resetKey(clientKey);

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a'.repeat(64), newPassword: 'ValidPassword123!' });
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'b'.repeat(64), newPassword: 'ValidPassword123!' });

    // Two different tokens, one budget: an attacker cannot get more Argon2
    // derivations by varying the token, which is the point of the IP-only key.
    expect((await resetPasswordRateLimit.getKey(clientKey))?.totalHits).toBe(2);

    resetPasswordRateLimit.resetKey(clientKey);
  });
});

describe('resend-verification limiter separation', () => {
  it('keeps its own counter, independent of the login limiter', async () => {
    const email = `ratelimit-${Date.now()}@example.com`;
    const key = buildScopedRateLimitKey(
      'resend-verification',
      email,
      ipKeyGenerator('127.0.0.1', 56)
    );

    await request(app).post('/api/auth/resend-verification').send({ email });

    expect((await resendVerificationRateLimit.getKey(key))?.totalHits).toBeGreaterThanOrEqual(1);

    resendVerificationRateLimit.resetKey(key);
    expect(await resendVerificationRateLimit.getKey(key)).toBeUndefined();
  });

  it('normalizes the address so casing and padding share one budget', async () => {
    const email = `casing-${Date.now()}@example.com`;
    const padded = `  ${email.toUpperCase()}  `;
    const key = buildScopedRateLimitKey(
      'resend-verification',
      email,
      ipKeyGenerator('127.0.0.1', 56)
    );

    await request(app).post('/api/auth/resend-verification').send({ email });
    await request(app).post('/api/auth/resend-verification').send({ email: padded });

    expect((await resendVerificationRateLimit.getKey(key))?.totalHits).toBe(2);

    resendVerificationRateLimit.resetKey(key);
  });
});

describe('rate limiter separation and store', () => {
  it('keeps authRateLimit and apiRateLimit on independent counters', async () => {
    await resetClientCounters();

    expect(await countedKey(authRateLimit)).toBeUndefined();
    expect(await countedKey(apiRateLimit)).toBeUndefined();

    await request(app).post('/api/auth/login').send({});
    expect(await countedKey(authRateLimit)).toBeDefined();
    expect(await countedKey(apiRateLimit)).toBeUndefined();

    await request(app).get('/api/dashboard/summary');
    expect(await countedKey(apiRateLimit)).toBeDefined();
  });

  it('does not let resetting one limiter clear the other', async () => {
    await resetClientCounters();

    await request(app).post('/api/auth/login').send({});
    await request(app).get('/api/dashboard/summary');

    const key = await countedKey(authRateLimit);
    expect(key).toBeDefined();

    const apiInfo = await apiRateLimit.getKey(key!);
    expect(apiInfo?.totalHits).toBeGreaterThanOrEqual(1);

    authRateLimit.resetKey(key!);
    expect(await authRateLimit.getKey(key!)).toBeUndefined();
    expect((await apiRateLimit.getKey(key!))?.totalHits).toBe(apiInfo?.totalHits);
  });

  it('keeps counters in a process-local in-memory store', async () => {
    await resetClientCounters();

    await request(app).post('/api/auth/login').send({});

    const key = await countedKey(authRateLimit);
    expect(key).toBeDefined();
    expect((await authRateLimit.getKey(key!))?.totalHits).toBeGreaterThanOrEqual(1);

    expect(await authRateLimit.getKey(NEVER_SEEN_KEY)).toBeUndefined();
    expect(await apiRateLimit.getKey(NEVER_SEEN_KEY)).toBeUndefined();

    authRateLimit.resetKey(key!);
    apiRateLimit.resetKey(key!);
    expect(await countedKey(authRateLimit)).toBeUndefined();
    expect(await countedKey(apiRateLimit)).toBeUndefined();
  });
});

describe('readiness probe rate limiting', () => {
  it('applies a dedicated budget to the probe that performs a database round trip', async () => {
    const response = await request(app).get('/api/health/ready');

    expect(response.status).toBe(200);
    // Liveness stays exempt (asserted above); readiness does not, because it
    // is unauthenticated and mounted ahead of the general API limiter.
    expect(response.headers['ratelimit-limit']).toBe(
      String(HEALTH_READINESS_RATE_LIMIT_MAX)
    );
  });

  it('stops an unauthenticated flood once the readiness budget is spent', async () => {
    for (let i = 0; i < HEALTH_READINESS_RATE_LIMIT_MAX; i += 1) {
      await request(app).get('/api/health/ready');
    }

    const blocked = await request(app).get('/api/health/ready');

    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    expect(blocked.body.error.code).toBe('RATE_LIMIT_EXCEEDED');

    // Leave the bucket empty for any later test in this file.
    for (const key of CLIENT_KEYS) {
      healthReadinessRateLimit.resetKey(key);
    }
  });
});
