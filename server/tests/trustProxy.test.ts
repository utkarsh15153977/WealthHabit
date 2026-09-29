import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import app from '../src/app.js';
import { env, resolveTrustProxy, type TrustProxyValue } from '../src/config/index.js';
import { apiRateLimit } from '../src/middleware/rateLimit.js';

const FORGED_IP = '203.0.113.99';
const PROXY_SEEN_IP = '198.51.100.7';

function buildApp(trustProxy: TrustProxyValue): express.Express {
  const instance = express();
  instance.set('trust proxy', trustProxy);
  instance.get('/probe', (req, res) => {
    res.json({ ip: req.ip, socket: req.socket.remoteAddress, ips: req.ips });
  });
  return instance;
}

function reportedCode(call: unknown[]): string | undefined {
  const [first] = call;
  if (typeof first === 'object' && first !== null && 'code' in first) {
    return String((first as { code: unknown }).code);
  }
  return undefined;
}

function reported(calls: unknown[][], code: string): boolean {
  return calls.some((call) => reportedCode(call) === code);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TRUST_PROXY configuration', () => {
  it('wires the default false into the running application', () => {
    expect(env.TRUST_PROXY).toBe(false);
    expect(app.get('trust proxy')).toBe(false);
  });

  it('never activates permissive trust from a literal true', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const value = resolveTrustProxy('true');
    expect(value).toBe(false);

    const instance = buildApp(value);
    expect(instance.get('trust proxy')).toBe(false);
    expect(instance.get('trust proxy')).not.toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('TRUST_PROXY')
    );

    const response = await request(instance)
      .get('/probe')
      .set('X-Forwarded-For', FORGED_IP);
    expect(response.body.ip).not.toBe(FORGED_IP);
  });

  it('fails closed to false for an invalid value', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const value = resolveTrustProxy('not-a-real-proxy');
    expect(value).toBe(false);
    expect(buildApp(value).get('trust proxy')).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('TRUST_PROXY')
    );
  });
});

describe('X-Forwarded-For trust boundary', () => {
  it('ignores X-Forwarded-For when trust proxy is disabled', async () => {
    const response = await request(buildApp(env.TRUST_PROXY))
      .get('/probe')
      .set('X-Forwarded-For', FORGED_IP);

    expect(response.body.ip).toBe(response.body.socket);
    expect(response.body.ip).not.toBe(FORGED_IP);
    expect(response.body.ips).toEqual([]);
  });

  it('uses the socket address when no forwarded header is present', async () => {
    const response = await request(buildApp(env.TRUST_PROXY)).get('/probe');

    expect(response.body.ip).toBe(response.body.socket);
    expect(response.body.ips).toEqual([]);
  });

  it('honours a single trusted proxy hop', async () => {
    const response = await request(buildApp(1))
      .get('/probe')
      .set('X-Forwarded-For', PROXY_SEEN_IP);

    expect(response.body.ip).toBe(PROXY_SEEN_IP);
    expect(response.body.ips).toEqual([PROXY_SEEN_IP]);
  });

  it('discards a forged left-most entry when the hop count matches the topology', async () => {
    const response = await request(buildApp(1))
      .get('/probe')
      .set('X-Forwarded-For', `${FORGED_IP}, ${PROXY_SEEN_IP}`);

    expect(response.body.ip).toBe(PROXY_SEEN_IP);
    expect(response.body.ip).not.toBe(FORGED_IP);
    expect(response.body.ips).toEqual([PROXY_SEEN_IP]);
  });

  it('trusts a matching proxy-addr symbolic range', async () => {
    const response = await request(buildApp('loopback'))
      .get('/probe')
      .set('X-Forwarded-For', PROXY_SEEN_IP);

    expect(response.body.ip).toBe(PROXY_SEEN_IP);
  });
});

describe('express-rate-limit proxy validations', () => {
  it('reports X-Forwarded-For on the auth limiter while trust proxy is disabled', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', FORGED_IP)
      .send({});

    expect(response.status).not.toBe(429);
    expect(reported(errorSpy.mock.calls, 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR')).toBe(true);
  });

  it('reports a permissive trust proxy configuration', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const instance = express();
    instance.set('trust proxy', true);
    instance.post('/limited', apiRateLimit, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const response = await request(instance).post('/limited');

    expect(response.status).toBe(200);
    expect(reported(errorSpy.mock.calls, 'ERR_ERL_PERMISSIVE_TRUST_PROXY')).toBe(true);
  });

  it('stays quiet when no forwarded header is present', async () => {
    const fresh = rateLimit({ windowMs: 60_000, max: 10 });
    const instance = express();
    instance.set('trust proxy', false);
    instance.post('/fresh', fresh, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(instance).post('/fresh');

    expect(response.status).toBe(200);
    expect(reported(errorSpy.mock.calls, 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR')).toBe(false);
    expect(reported(errorSpy.mock.calls, 'ERR_ERL_INVALID_IP_ADDRESS')).toBe(false);
    expect(reported(errorSpy.mock.calls, 'ERR_ERL_UNDEFINED_IP_ADDRESS')).toBe(false);
  });

  it('flags X-Forwarded-For on a freshly created limiter', async () => {
    const fresh = rateLimit({ windowMs: 60_000, max: 10 });
    const instance = express();
    instance.set('trust proxy', false);
    instance.post('/fresh', fresh, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(instance)
      .post('/fresh')
      .set('X-Forwarded-For', FORGED_IP);

    expect(response.status).toBe(200);
    expect(reported(errorSpy.mock.calls, 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR')).toBe(true);
  });
});
