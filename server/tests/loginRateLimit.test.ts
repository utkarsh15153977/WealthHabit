import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/index.js';
import {
  LOGIN_RATE_LIMIT_MAX,
  buildLoginRateLimitKey,
  loginRateLimit,
  normalizeLoginEmail,
} from '../src/middleware/rateLimit.js';

const LOGIN_LIMIT = String(LOGIN_RATE_LIMIT_MAX);
const AUTH_LIMIT = String(env.isDevelopment ? 100 : 20);

const RATE_LIMIT_PAYLOAD = {
  success: false,
  error: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests, please try again later',
  },
};

const CLIENT_IP = '198.51.100.10';
const OTHER_CLIENT_IP = '198.51.100.20';
const FORGED_IP = '203.0.113.99';

function buildLoginProbe(trustProxy: boolean | number | string[]): express.Express {
  const instance = express();
  instance.set('trust proxy', trustProxy);
  instance.use(express.json());
  instance.post('/login', loginRateLimit, (req, res) => {
    res.status(200).json({ ip: req.ip });
  });
  return instance;
}

type LoginAttempt = {
  email?: string;
  forwardedFor?: string;
};

async function attempt(probe: express.Express, { email, forwardedFor }: LoginAttempt) {
  const req = request(probe).post('/login');
  if (forwardedFor !== undefined) req.set('X-Forwarded-For', forwardedFor);
  if (email !== undefined) req.send({ email, password: 'anything' });
  else req.send({});
  return req;
}

async function exhaust(
  probe: express.Express,
  attemptOptions: LoginAttempt
): Promise<request.Response> {
  let last: request.Response | undefined;
  for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
    last = await attempt(probe, attemptOptions);
  }
  return last!;
}

describe('Login limiter key derivation', () => {
  it('normalizes the email exactly like the login path does', () => {
    expect(normalizeLoginEmail({ email: ' User@Example.COM ' })).toBe('user@example.com');
    expect(normalizeLoginEmail({ email: 'user@example.com' })).toBe('user@example.com');
    expect(normalizeLoginEmail({ email: 'USER@EXAMPLE.COM' })).toBe('user@example.com');
    expect(normalizeLoginEmail({ email: '   ' })).toBeUndefined();
    expect(normalizeLoginEmail({ email: 42 })).toBeUndefined();
    expect(normalizeLoginEmail({})).toBeUndefined();
    expect(normalizeLoginEmail(undefined)).toBeUndefined();
    expect(normalizeLoginEmail(null)).toBeUndefined();
    expect(normalizeLoginEmail('user@example.com')).toBeUndefined();
  });

  it('produces one shared key for every casing/whitespace variant of an email plus the same IP', () => {
    const ip = '198.51.100.10';
    const canonical = buildLoginRateLimitKey('user@example.com', ip);

    expect(buildLoginRateLimitKey(normalizeLoginEmail({ email: ' User@Example.COM ' }), ip)).toBe(canonical);
    expect(buildLoginRateLimitKey(normalizeLoginEmail({ email: 'USER@EXAMPLE.COM' }), ip)).toBe(canonical);
  });

  it('distinguishes different emails from the same client IP', () => {
    const ip = '198.51.100.10';

    expect(buildLoginRateLimitKey('first@example.com', ip)).not.toBe(
      buildLoginRateLimitKey('second@example.com', ip)
    );
  });

  it('distinguishes the same email from different trusted client IPs', () => {
    expect(buildLoginRateLimitKey('user@example.com', CLIENT_IP)).not.toBe(
      buildLoginRateLimitKey('user@example.com', OTHER_CLIENT_IP)
    );
  });

  it('falls back to a stable IP-only key when no usable email is present', () => {
    const ip = '198.51.100.10';
    const fallback = buildLoginRateLimitKey(undefined, ip);

    expect(fallback).toBe(buildLoginRateLimitKey(undefined, ip));
    expect(fallback).not.toBe(buildLoginRateLimitKey('user@example.com', ip));
  });

  it('cannot be forged through separators embedded in the email', () => {
    const victim = buildLoginRateLimitKey('victim@example.com', CLIENT_IP);
    const forged = buildLoginRateLimitKey(
      `victim@example.com","${CLIENT_IP}`,
      OTHER_CLIENT_IP
    );

    expect(forged).not.toBe(victim);
  });
});

describe('Dedicated login limiter on the real login route', () => {
  it('caps POST /api/auth/login with a stricter dedicated limiter and the shared payload', async () => {
    let last: request.Response | undefined;
    for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
      last = await request(app).post('/api/auth/login').send({});
    }

    expect(last!.status).toBe(429);
    expect(last!.headers['ratelimit-limit']).toBe(LOGIN_LIMIT);
    expect(last!.headers['ratelimit-policy']).toBeDefined();
    expect(last!.body).toEqual(RATE_LIMIT_PAYLOAD);
    expect(LOGIN_RATE_LIMIT_MAX).toBeLessThan(env.isDevelopment ? 500 : 100);
    expect(LOGIN_RATE_LIMIT_MAX).toBeLessThan(env.isDevelopment ? 100 : 20);
  });

  it('does not leak the submitted email or any account existence signal in the 429 response', async () => {
    const email = 'never-seen-login-limit@example.com';

    let last: request.Response | undefined;
    for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
      last = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'whatever' });
    }

    expect(last!.status).toBe(429);
    expect(JSON.stringify(last!.body)).not.toContain(email);
    expect(last!.body).toEqual(RATE_LIMIT_PAYLOAD);
  });

  it('keeps every other auth route on the general auth limiter only', async () => {
    for (const path of ['/api/auth/register', '/api/auth/refresh', '/api/auth/logout']) {
      const response = await request(app).post(path).send({});

      expect(response.status).not.toBe(429);
      expect(response.headers['ratelimit-limit']).toBe(AUTH_LIMIT);
      expect(response.headers['ratelimit-limit']).not.toBe(LOGIN_LIMIT);
    }
  });
});

describe('Login limiter client identity under the configured trust boundary', () => {
  it('gives multiple clients behind one trusted proxy distinct buckets (trust proxy = 1)', async () => {
    const probe = buildLoginProbe(1);

    const first = await attempt(probe, { email: 'shared@example.com', forwardedFor: CLIENT_IP });
    expect(first.status).toBe(200);
    expect(first.body.ip).toBe(CLIENT_IP);

    const limited = await exhaust(probe, {
      email: 'shared@example.com',
      forwardedFor: CLIENT_IP,
    });
    expect(limited.status).toBe(429);

    const otherClient = await attempt(probe, {
      email: 'shared@example.com',
      forwardedFor: OTHER_CLIENT_IP,
    });
    expect(otherClient.status).toBe(200);
    expect(otherClient.body.ip).toBe(OTHER_CLIENT_IP);
  });

  it('shares one bucket for the same normalized email from the same trusted client IP', async () => {
    const probe = buildLoginProbe(1);
    const variants = ['Bucket@Share.test', ' bucket@share.TEST ', 'BUCKET@SHARE.TEST'];

    let last: request.Response | undefined;
    for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
      last = await attempt(probe, {
        email: variants[i % variants.length],
        forwardedFor: CLIENT_IP,
      });
    }

    expect(last!.status).toBe(429);
    expect(last!.body).toEqual(RATE_LIMIT_PAYLOAD);
    expect(JSON.stringify(last!.body).toLowerCase()).not.toContain('bucket@share.test');
  });

  it('keeps different emails from the same client IP in separate buckets', async () => {
    const probe = buildLoginProbe(1);

    const limited = await exhaust(probe, { email: 'alpha@example.com', forwardedFor: CLIENT_IP });
    expect(limited.status).toBe(429);

    const otherEmail = await attempt(probe, {
      email: 'beta@example.com',
      forwardedFor: CLIENT_IP,
    });
    expect(otherEmail.status).toBe(200);
  });

  it('cannot be bypassed by a forged left-most X-Forwarded-For entry under a trusted hop count', async () => {
    const probe = buildLoginProbe(1);

    let last: request.Response | undefined;
    for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
      last = await attempt(probe, {
        email: 'victim@example.com',
        forwardedFor: `${FORGED_IP}.${i}, ${CLIENT_IP}`,
      });
    }

    expect(last!.status).toBe(429);

    const probe2 = buildLoginProbe(1);
    const identity = await attempt(probe2, {
      email: 'identity@example.com',
      forwardedFor: `${FORGED_IP}, ${CLIENT_IP}`,
    });
    expect(identity.body.ip).toBe(CLIENT_IP);
    expect(identity.body.ip).not.toBe(FORGED_IP);
  });

  it('cannot be bypassed by rotating untrusted X-Forwarded-For headers when trust proxy is disabled', async () => {
    const probe = buildLoginProbe(env.TRUST_PROXY);

    const first = await attempt(probe, {
      email: 'no-trust@example.com',
      forwardedFor: FORGED_IP,
    });
    expect(first.status).toBe(200);
    expect(first.body.ip).not.toBe(FORGED_IP);

    let last: request.Response | undefined;
    for (let i = 0; i <= LOGIN_RATE_LIMIT_MAX; i++) {
      last = await attempt(probe, {
        email: 'no-trust@example.com',
        forwardedFor: `${FORGED_IP}.${i}`,
      });
    }

    expect(last!.status).toBe(429);
    expect(last!.body).toEqual(RATE_LIMIT_PAYLOAD);
  });

  it('keeps req.ip on the TCP socket when trust proxy is disabled (no forwarded header)', async () => {
    const probe = buildLoginProbe(false);

    const response = await attempt(probe, { email: 'socket-identity@example.com' });

    expect(response.status).toBe(200);
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(response.body.ip);
  });
});
