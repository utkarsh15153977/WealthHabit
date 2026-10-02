import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import app from '../src/app.js';
import {
  MAX_REQUEST_ID_LENGTH,
  REQUEST_ID_HEADER,
  generateRequestId,
  getRequestId,
  normalizeIncomingRequestId,
  requestIdMiddleware,
} from '../src/middleware/requestId.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildApp(): express.Express {
  const instance = express();
  instance.use(requestIdMiddleware);
  instance.get('/probe', (req, res) => {
    res.json({ requestId: getRequestId(req) });
  });
  return instance;
}

describe('request ID generation', () => {
  it('generates cryptographically random UUID v4 identifiers', () => {
    const first = generateRequestId();
    const second = generateRequestId();

    expect(first).toMatch(UUID_PATTERN);
    expect(second).toMatch(UUID_PATTERN);
    expect(first).not.toBe(second);
  });

  it('generates a new request ID when no incoming header exists', async () => {
    const response = await request(buildApp()).get('/probe');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toMatch(UUID_PATTERN);
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('generates a distinct request ID per request', async () => {
    const instance = buildApp();

    const first = await request(instance).get('/probe');
    const second = await request(instance).get('/probe');

    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });
});

describe('incoming request ID handling', () => {
  it('accepts and echoes a well-formed incoming X-Request-Id', async () => {
    const response = await request(buildApp())
      .get('/probe')
      .set('X-Request-Id', 'client-trace-12345');

    expect(response.headers['x-request-id']).toBe('client-trace-12345');
    expect(response.body.requestId).toBe('client-trace-12345');
  });

  it('rejects malformed incoming IDs and falls back to a generated one', async () => {
    const instance = buildApp();

    const spaced = await request(instance)
      .get('/probe')
      .set('X-Request-Id', 'id with spaces');
    const oversized = await request(instance)
      .get('/probe')
      .set('X-Request-Id', 'a'.repeat(MAX_REQUEST_ID_LENGTH + 1));
    const punctuated = await request(instance)
      .get('/probe')
      .set('X-Request-Id', '../../etc/passwd');

    for (const response of [spaced, oversized, punctuated]) {
      expect(response.headers['x-request-id']).toMatch(UUID_PATTERN);
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
    }
  });

  it('normalizes only bounded, log-safe identifiers', () => {
    expect(normalizeIncomingRequestId('trace-ABC_01.2')).toBe('trace-ABC_01.2');
    expect(normalizeIncomingRequestId('  padded-id  ')).toBe('padded-id');

    expect(normalizeIncomingRequestId('')).toBeNull();
    expect(normalizeIncomingRequestId('   ')).toBeNull();
    expect(normalizeIncomingRequestId('has spaces')).toBeNull();
    expect(normalizeIncomingRequestId('line\nbreak')).toBeNull();
    expect(normalizeIncomingRequestId('inject\r\nheader: yes')).toBeNull();
    expect(normalizeIncomingRequestId('colon:separated')).toBeNull();
    expect(normalizeIncomingRequestId('a'.repeat(65))).toBeNull();
    expect(normalizeIncomingRequestId(42)).toBeNull();
    expect(normalizeIncomingRequestId(undefined)).toBeNull();
    expect(normalizeIncomingRequestId(null)).toBeNull();
  });
});

describe('application-level request ID wiring', () => {
  it('echoes X-Request-Id on successful API responses', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toMatch(UUID_PATTERN);
  });

  it('echoes X-Request-Id on 404 responses', async () => {
    const response = await request(app).get('/api/no-such-route-5g4');

    expect(response.status).toBe(404);
    expect(response.headers['x-request-id']).toMatch(UUID_PATTERN);
  });

  it('honours a valid incoming ID on the full application', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('X-Request-Id', 'upstream-trace-42');

    expect(response.headers['x-request-id']).toBe('upstream-trace-42');
  });

  it('uses REQUEST_ID_HEADER for the response header name', () => {
    expect(REQUEST_ID_HEADER).toBe('X-Request-Id');
  });
});
