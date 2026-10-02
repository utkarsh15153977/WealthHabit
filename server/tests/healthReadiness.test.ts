import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/index.js';
import { prisma } from '../src/config/prisma.js';
import {
  checkDatabaseHealth,
  DATABASE_FAILURE_MESSAGE,
} from '../src/services/adminSystemHealthService.js';

const LEAKY_DB_ERROR_MESSAGE =
  "Can't reach database server at `db.internal:5432` " +
  'DATABASE_URL=postgresql://wealthhabit:SuperSecretPass@db.internal:5432/wealthhabit ' +
  'password=SuperSecretPass connect ECONNREFUSED';

const LEAKY_MARKERS = [
  'SuperSecretPass',
  'postgresql://',
  'wealthhabit:',
  'db.internal',
  'ECONNREFUSED',
  'DATABASE_URL',
  'password=',
];

function assertNoDatabaseDetails(raw: string): void {
  for (const marker of LEAKY_MARKERS) {
    expect(raw.includes(marker)).toBe(false);
  }
  expect(raw.includes('.ts:')).toBe(false);
  expect(raw.includes('node_modules')).toBe(false);
  expect(raw.includes('SELECT 1')).toBe(false);
}

describe('GET /api/health (liveness)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('remains 200 with the unchanged, dependency-free payload', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'WealthHabit API is running',
    });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('never calls the database', async () => {
    const querySpy = vi.spyOn(prisma, '$queryRaw');

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('stays 200 even while the database is failing', async () => {
    const querySpy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error(LEAKY_DB_ERROR_MESSAGE));

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(querySpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/health/ready (readiness)', () => {
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

  it('returns 200 when the database is reachable', async () => {
    const response = await request(app).get('/api/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'WealthHabit API is ready',
    });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('is usable without authentication for infrastructure probes', async () => {
    const response = await request(app).get('/api/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.error).toBeUndefined();
  });

  it('returns 503 with a generic payload when the database check fails', async () => {
    const querySpy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error(LEAKY_DB_ERROR_MESSAGE));

    const response = await request(app).get('/api/health/ready');
    querySpy.mockRestore();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      message: 'Service unavailable',
    });
    assertNoDatabaseDetails(JSON.stringify(response.body));
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('never exposes DATABASE_URL, credentials, Prisma errors or stack traces', async () => {
    const querySpy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error(LEAKY_DB_ERROR_MESSAGE));

    const response = await request(app).get('/api/health/ready');
    querySpy.mockRestore();

    const rawBody = JSON.stringify(response.body);
    assertNoDatabaseDetails(rawBody);
    if (env.DATABASE_URL) {
      expect(rawBody.includes(env.DATABASE_URL)).toBe(false);
    }

    const allLogs = [...errorLogs, ...infoLogs].join('\n');
    assertNoDatabaseDetails(allLogs);
    if (env.DATABASE_URL) {
      expect(allLogs.includes(env.DATABASE_URL)).toBe(false);
    }
  });

  it('logs the failure with the request ID through the 5G.4 structured logger', async () => {
    const querySpy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error(LEAKY_DB_ERROR_MESSAGE));

    const response = await request(app).get('/api/health/ready');
    querySpy.mockRestore();

    expect(response.status).toBe(503);
    const requestId = response.headers['x-request-id'];

    const errorLog = errorLogs.find((line) => line.includes('Readiness check failed'));
    expect(errorLog).toBeDefined();
    expect(errorLog).toContain(requestId);
    expect(errorLog).toContain('503');

    const completionLog = infoLogs.find((line) => line.includes('request completed'));
    expect(completionLog).toBeDefined();
    expect(completionLog).toContain(requestId);
    expect(completionLog).toContain('503');
  });

  it('is mockable through an injected database-health runner', async () => {
    const healthy = await checkDatabaseHealth(async () => undefined);
    expect(healthy.status).toBe('HEALTHY');

    const failing = await checkDatabaseHealth(async () => {
      throw new Error(LEAKY_DB_ERROR_MESSAGE);
    });
    expect(failing.status).toBe('UNHEALTHY');
    expect(failing.message).toBe(DATABASE_FAILURE_MESSAGE);
    assertNoDatabaseDetails(JSON.stringify(failing));
  });
});
