import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/index.js';

const API_LIMIT = String(env.isDevelopment ? 500 : 100);
const AUTH_LIMIT = String(env.isDevelopment ? 100 : 20);

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

  it('returns a RATE_LIMIT_EXCEEDED error payload when limited', async () => {
    let limited: request.Response | undefined;

    for (let i = 0; i <= AUTH_LIMIT; i++) {
      const response = await request(app).post('/api/auth/login').send({});
      if (response.status === 429) {
        limited = response;
        break;
      }
    }

    expect(limited).toBeDefined();
    expect(limited!.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
