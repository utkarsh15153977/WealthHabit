import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { env } from '../src/config/index.js';
import { AppError } from '../src/utils/errors.js';
import { formatLogEntry } from '../src/utils/logger.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { requestLogger } from '../src/middleware/logger.js';
import { requestIdMiddleware } from '../src/middleware/requestId.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECRET_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1g';
const SECRET_COOKIE = 'refresh-cookie-secret-abc123';
const SECRET_PASSWORD = 'Sup3rS3cretPass!';
const SECRET_BODY_TOKEN = 'rt_body_secret_value';

interface RouteDefinition {
  path: string;
  method: 'get' | 'post';
  handler: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
}

function buildApp(routes: RouteDefinition[]): Express {
  const instance = express();
  instance.use(requestIdMiddleware);
  instance.use(express.json());
  instance.use(requestLogger);
  for (const route of routes) {
    instance[route.method](route.path, route.handler);
  }
  instance.use(errorHandler);
  return instance;
}

function buildFailingApp(): Express {
  return buildApp([
    {
      path: '/api/boom',
      method: 'post',
      handler: (_req, _res, next) => next(new Error('Unexpected database failure')),
    },
  ]);
}

/** The completion log is emitted from the response `finish` event. */
function flushCompletionLogs(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe('unexpected 500 error logging', () => {
  let errorLogs: string[];
  let infoLogs: string[];

  beforeEach(() => {
    errorLogs = [];
    infoLogs = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      infoLogs.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a generic 500 with an X-Request-Id and no stack trace', async () => {
    // Tests run outside development, which exercises the production branch:
    // the client always receives the generic message.
    expect(env.isDevelopment).toBe(false);

    const response = await request(buildFailingApp()).post('/api/boom');

    expect(response.status).toBe(500);
    expect(response.headers['x-request-id']).toMatch(UUID_PATTERN);

    expect(response.body.message).toBe('Internal Server Error');
    expect(response.body.error.message).toBe('Internal Server Error');
    expect(response.body.error.code).toBe('INTERNAL_ERROR');

    expect(response.text).not.toContain('Unexpected database failure');
    expect(response.text).not.toContain('.ts:');
    expect(response.text).not.toContain('at ');
  });

  it('logs the request ID, error name, message and full stack trace', async () => {
    const response = await request(buildFailingApp()).post('/api/boom');
    const requestId = response.headers['x-request-id'];

    const logged = errorLogs.join('\n');
    expect(logged).toContain('Unexpected error');
    expect(logged).toContain(`requestId: ${requestId}`);
    expect(logged).toContain('errorName: Error');
    expect(logged).toContain('Unexpected database failure');
    expect(logged).toContain('stack:');

    const frames = logged.split('\n').filter((line) => line.trim().startsWith('at '));
    expect(frames.length).toBeGreaterThanOrEqual(2);
  });

  it('logs a 500 for every status the error handler emits and correlates via one ID', async () => {
    const response = await request(buildFailingApp()).post('/api/boom');
    const requestId = response.headers['x-request-id'];
    await flushCompletionLogs();

    const errorLine = errorLogs.find((line) => line.includes('Unexpected error'));
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain(requestId);
    expect(errorLine).toContain('status: 500');

    const completionLine = infoLogs.find((line) => line.includes('request completed'));
    expect(completionLine).toBeDefined();
    expect(completionLine).toContain(requestId);
    expect(completionLine).toContain('status: 500');
  });

  it('propagates an incoming request ID into the error log', async () => {
    const response = await request(buildFailingApp())
      .post('/api/boom')
      .set('X-Request-Id', 'inbound-trace-99');

    expect(response.headers['x-request-id']).toBe('inbound-trace-99');
    expect(errorLogs.join('\n')).toContain('requestId: inbound-trace-99');
  });

  it('never logs Authorization headers, cookies or body secrets', async () => {
    const response = await request(buildFailingApp())
      .post('/api/boom')
      .set('Authorization', `Bearer ${SECRET_JWT}`)
      .set('Cookie', `wh_refresh_token=${SECRET_COOKIE}`)
      .send({ password: SECRET_PASSWORD, refreshToken: SECRET_BODY_TOKEN });

    expect(response.status).toBe(500);
    await flushCompletionLogs();

    const allLogs = [...errorLogs, ...infoLogs].join('\n');
    expect(allLogs).not.toContain(SECRET_JWT);
    expect(allLogs).not.toContain(SECRET_COOKIE);
    expect(allLogs).not.toContain(SECRET_PASSWORD);
    expect(allLogs).not.toContain(SECRET_BODY_TOKEN);
    expect(allLogs).not.toContain('wh_refresh_token');
    expect(allLogs).not.toContain('Authorization');
    expect(allLogs).not.toContain('Bearer ');
  });

  it('redacts secrets embedded in the error message and stack (5G.3 protection)', async () => {
    const instance = buildApp([
      {
        path: '/api/leaky',
        method: 'post',
        handler: (_req, _res, next) =>
          next(
            new Error(
              'query failed url=postgresql://wealthhabit:s3cr3t@db.internal:5432/app password=hunter2 Bearer abc.def.ghi'
            )
          ),
      },
    ]);

    const response = await request(instance).post('/api/leaky');
    const allLogs = [...errorLogs, ...infoLogs].join('\n');

    expect(allLogs).toContain('password=[redacted]');
    expect(allLogs).toContain('Bearer [redacted]');
    expect(allLogs).not.toContain('hunter2');
    expect(allLogs).not.toContain('s3cr3t');
    expect(allLogs).not.toContain('abc.def.ghi');

    // The client response stays generic in non-development environments.
    expect(response.status).toBe(500);
    expect(response.text).not.toContain('hunter2');
    expect(response.text).not.toContain('s3cr3t');
  });

  it('does not log unexpected-error records for handled AppError responses', async () => {
    const instance = buildApp([
      {
        path: '/api/unauthorized',
        method: 'get',
        handler: (_req, _res, next) => next(AppError.unauthorized('Not allowed')),
      },
    ]);

    const response = await request(instance).get('/api/unauthorized');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Not allowed');
    expect(response.headers['x-request-id']).toMatch(UUID_PATTERN);
    expect(errorLogs.join('\n')).not.toContain('Unexpected error');
  });

  it('does not log unexpected-error records for validation failures', async () => {
    const schema = z.object({ email: z.string().email() });
    const instance = buildApp([
      {
        path: '/api/invalid',
        method: 'post',
        handler: (_req, _res, next) => next(schema.parse({ email: 'nope' })),
      },
    ]);

    const response = await request(instance).post('/api/invalid');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(errorLogs.join('\n')).not.toContain('Unexpected error');
  });
});

describe('structured log formatting', () => {
  const stack = new Error('boom').stack ?? '';

  it('emits a single JSON record in production containing the stack trace', () => {
    const line = formatLogEntry(
      'error',
      'Unexpected error',
      { requestId: 'req-1', status: 500, errorName: 'Error', errorMessage: 'boom', stack },
      { json: true }
    );

    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('Unexpected error');
    expect(parsed.requestId).toBe('req-1');
    expect(parsed.status).toBe(500);
    expect(parsed.errorName).toBe('Error');
    expect(parsed.errorMessage).toBe('boom');
    expect(parsed.stack).toContain('at ');
    expect(parsed.timestamp).toBeTruthy();
  });

  it('stays readable outside production', () => {
    const line = formatLogEntry(
      'error',
      'Unexpected error',
      { requestId: 'req-1', stack },
      { json: false }
    );

    expect(line).toContain('ERROR Unexpected error');
    expect(line).toContain('requestId: req-1');
    expect(line).toContain('stack:');
    expect(line).toContain('at ');
    expect(() => JSON.parse(line)).toThrow();
  });

  it('redacts secrets in message and context values in both formats', () => {
    const json = formatLogEntry(
      'error',
      'failed password=hunter2',
      { errorMessage: 'token=abc123' },
      { json: true }
    );
    const readable = formatLogEntry(
      'error',
      'failed password=hunter2',
      { errorMessage: 'token=abc123' },
      { json: false }
    );

    expect(JSON.parse(json).message).toBe('failed password=[redacted]');
    expect(JSON.parse(json).errorMessage).toBe('token=[redacted]');
    expect(readable).toContain('password=[redacted]');
    expect(readable).toContain('token=[redacted]');
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('abc123');
    expect(readable).not.toContain('hunter2');
    expect(readable).not.toContain('abc123');
  });
});
