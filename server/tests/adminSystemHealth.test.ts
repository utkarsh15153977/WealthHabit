import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { AccountStatus, Role } from '@prisma/client';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { prisma } from '../src/config/prisma.js';
import adminSystemHealthRoutes from '../src/routes/adminSystemHealthRoutes.js';
import {
  checkDatabaseHealth,
  deriveOverallStatus,
  DATABASE_FAILURE_MESSAGE,
} from '../src/services/adminSystemHealthService.js';

interface TestUser {
  id: string;
  email: string;
  password: string;
}

const COMPONENT_STATUSES = ['HEALTHY', 'DEGRADED', 'UNHEALTHY'];

describe('Admin system health API', () => {
  let app: express.Express;
  let admin: TestUser;
  let user: TestUser;
  let tokenAdmin: string;
  let tokenUser: string;

  async function createUser(
    role: Role,
    status: AccountStatus
  ): Promise<TestUser> {
    const draft = createTestUser();
    const created = await testPrisma.user.create({
      data: {
        email: draft.email,
        passwordHash: await hashPassword(draft.password),
        firstName: draft.firstName,
        lastName: draft.lastName,
        role,
        status,
      },
    });
    return { id: created.id, email: created.email, password: draft.password };
  }

  beforeEach(async () => {
    admin = await createUser(Role.ADMIN, AccountStatus.ACTIVE);
    user = await createUser(Role.USER, AccountStatus.ACTIVE);

    tokenAdmin = authService.generateAccessToken({
      id: admin.id,
      role: Role.ADMIN,
    });
    tokenUser = authService.generateAccessToken({
      id: user.id,
      role: Role.USER,
    });

    app = express();
    app.use(express.json());
    app.use('/api/admin', adminSystemHealthRoutes);
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function get(url: string, token?: string) {
    const req = request(app).get(url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  describe('authorization', () => {
    it('rejects anonymous requests with 401', async () => {
      const res = await get('/api/admin/system-health');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects a normal USER with 403', async () => {
      const res = await get('/api/admin/system-health', tokenUser);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('allows an ADMIN with 200', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('rejects a suspended admin with 403 ACCOUNT_SUSPENDED', async () => {
      await testPrisma.user.update({
        where: { id: admin.id },
        data: { status: AccountStatus.SUSPENDED },
      });
      const res = await get('/api/admin/system-health', tokenAdmin);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('rejects a deactivated admin with 403', async () => {
      await testPrisma.user.update({
        where: { id: admin.id },
        data: { status: AccountStatus.DEACTIVATED },
      });
      const res = await get('/api/admin/system-health', tokenAdmin);
      expect(res.status).toBe(403);
    });
  });

  describe('spoofing resistance', () => {
    it('ignores an X-User-Role: ADMIN header', async () => {
      const res = await request(app)
        .get('/api/admin/system-health')
        .set('Authorization', `Bearer ${tokenUser}`)
        .set('X-User-Role', 'ADMIN');
      expect(res.status).toBe(403);
    });

    it('ignores an X-User-Id header of an admin', async () => {
      const res = await request(app)
        .get('/api/admin/system-health')
        .set('Authorization', `Bearer ${tokenUser}`)
        .set('X-User-Id', admin.id);
      expect(res.status).toBe(403);
    });

    it('ignores a ?role=ADMIN query parameter', async () => {
      const res = await get('/api/admin/system-health?role=ADMIN', tokenUser);
      expect(res.status).toBe(403);
    });

    it('ignores a role field in the request body', async () => {
      const res = await request(app)
        .get('/api/admin/system-health')
        .set('Authorization', `Bearer ${tokenUser}`)
        .send({ role: 'ADMIN' });
      expect(res.status).toBe(403);
    });
  });

  describe('response shape', () => {
    it('returns success and the allowlisted data sections', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Object.keys(res.body.data).sort()).toEqual([
        'application',
        'database',
        'generatedAt',
        'runtime',
        'status',
      ]);
    });

    it('returns a valid overall status', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      expect(COMPONENT_STATUSES).toContain(res.body.data.status);
    });

    it('returns a generatedAt timestamp', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      const generatedAt = res.body.data.generatedAt;
      expect(typeof generatedAt).toBe('string');
      const parsed = Date.parse(generatedAt);
      expect(Number.isNaN(parsed)).toBe(false);
      expect(Math.abs(Date.now() - parsed)).toBeLessThan(60_000);
    });

    it('returns an allowlisted application section', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      expect(Object.keys(res.body.data.application).sort()).toEqual([
        'environment',
        'service',
        'status',
        'uptimeSeconds',
      ]);
      expect(res.body.data.application.status).toBe('HEALTHY');
      expect(res.body.data.application.service).toBe('WealthHabit API');
      expect(['development', 'test', 'production']).toContain(
        res.body.data.application.environment
      );
    });

    it('returns an allowlisted database section', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      expect(Object.keys(res.body.data.database).sort()).toEqual([
        'latencyMs',
        'message',
        'status',
      ]);
    });

    it('returns an allowlisted runtime section with safe memory fields', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      expect(Object.keys(res.body.data.runtime).sort()).toEqual([
        'memory',
        'nodeVersion',
        'status',
        'uptimeSeconds',
      ]);
      expect(Object.keys(res.body.data.runtime.memory).sort()).toEqual([
        'heapTotalMb',
        'heapUsedMb',
        'rssMb',
      ]);
    });
  });

  describe('database health', () => {
    it('reports a healthy database through the live connection', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      expect(res.body.data.database.status).toBe('HEALTHY');
      expect(res.body.data.database.message).toBeNull();
    });

    it('returns a numeric, non-negative health-query latency', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      const latency = res.body.data.database.latencyMs;
      expect(typeof latency).toBe('number');
      expect(Number.isFinite(latency)).toBe(true);
      expect(latency).toBeGreaterThanOrEqual(0);
    });

    it('derives an UNHEALTHY overall status when the database check fails', async () => {
      const spy = vi
        .spyOn(prisma, '$queryRaw')
        .mockRejectedValueOnce(
          new Error('Could not reach DATABASE_URL=postgresql://user:pass@host/db')
        );
      const res = await get('/api/admin/system-health', tokenAdmin);
      spy.mockRestore();

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('UNHEALTHY');
      expect(res.body.data.database.status).toBe('UNHEALTHY');
      expect(res.body.data.database.latencyMs).toBeNull();
      expect(res.body.data.database.message).toBe(DATABASE_FAILURE_MESSAGE);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('postgresql://');
      expect(raw).not.toContain('Could not reach');
      expect(raw).not.toContain('pass@');
    });

    it('turns a throwing health runner into a safe UNHEALTHY result', async () => {
      const result = await checkDatabaseHealth(async () => {
        throw new Error('ECONNREFUSED DATABASE_URL=postgresql://secret-host/db');
      });
      expect(result.status).toBe('UNHEALTHY');
      expect(result.latencyMs).toBeNull();
      expect(result.message).toBe(DATABASE_FAILURE_MESSAGE);
      const raw = JSON.stringify(result);
      expect(raw).not.toContain('ECONNREFUSED');
      expect(raw).not.toContain('postgresql://');
      expect(raw).not.toContain('secret-host');
    });

    it('measures latency for a successful health runner', async () => {
      const result = await checkDatabaseHealth(async () => undefined);
      expect(result.status).toBe('HEALTHY');
      expect(typeof result.latencyMs).toBe('number');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.message).toBeNull();
    });
  });

  describe('sensitive data never appears', () => {
    it('omits database URLs, secrets, tokens, cookies and hashes', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      const raw = JSON.stringify(res.body);

      const forbiddenValues = [
        process.env.DATABASE_URL,
        process.env.JWT_ACCESS_SECRET,
        'dev-secret-change-in-production',
        tokenAdmin,
      ].filter((value): value is string => Boolean(value));
      for (const value of forbiddenValues) {
        expect(raw.includes(value)).toBe(false);
      }

      const forbiddenKeys = [
        'DATABASE_URL',
        'JWT_SECRET',
        'JWT_ACCESS_SECRET',
        'accessToken',
        'refreshToken',
        'passwordHash',
        'refreshTokenHash',
        'previousRefreshTokenHash',
        'process.env',
        'cookie',
        'authorization',
        'apiKey',
      ];
      for (const key of forbiddenKeys) {
        expect(raw.includes(key)).toBe(false);
      }
    });

    it('omits filesystem paths and stack traces', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      const raw = JSON.stringify(res.body);

      expect(raw.includes(process.cwd())).toBe(false);
      expect(raw.includes('node_modules')).toBe(false);
      expect(raw.includes('server/src')).toBe(false);
      expect(raw.includes('F:\\Projects')).toBe(false);
      expect(raw.includes('\\n    at ')).toBe(false);
      expect(raw.includes('Error:')).toBe(false);
      expect(raw.includes('prisma/')).toBe(false);
    });

    it('omits arbitrary process internals', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      const raw = JSON.stringify(res.body);

      expect(raw.includes('"pid"')).toBe(false);
      expect(raw.includes('"argv"')).toBe(false);
      expect(raw.includes('"cwd"')).toBe(false);
      expect(raw.includes('"execPath"')).toBe(false);
      expect(raw.includes('"env"')).toBe(false);
      expect(raw.includes('"platform"')).toBe(false);
    });
  });

  describe('read-only guarantees', () => {
    it('does not create audit logs or touch user rows', async () => {
      const auditBefore = await testPrisma.auditLog.count();
      const usersBefore = await testPrisma.user.count();

      await get('/api/admin/system-health', tokenAdmin);
      await get('/api/admin/system-health', tokenAdmin);
      await get('/api/admin/system-health', tokenAdmin);

      expect(await testPrisma.auditLog.count()).toBe(auditBefore);
      expect(await testPrisma.user.count()).toBe(usersBefore);
    });

    it('does not create notifications or financial records', async () => {
      const notificationsBefore = await testPrisma.notification.count();
      const transactionsBefore = await testPrisma.transaction.count();
      const goalsBefore = await testPrisma.savingsGoal.count();
      const habitsBefore = await testPrisma.financialHabit.count();

      await get('/api/admin/system-health', tokenAdmin);
      await get('/api/admin/system-health', tokenAdmin);

      expect(await testPrisma.notification.count()).toBe(notificationsBefore);
      expect(await testPrisma.transaction.count()).toBe(transactionsBefore);
      expect(await testPrisma.savingsGoal.count()).toBe(goalsBefore);
      expect(await testPrisma.financialHabit.count()).toBe(habitsBefore);
    });

    it('does not touch assets, liabilities, snapshots or challenges', async () => {
      const assetsBefore = await testPrisma.asset.count();
      const liabilitiesBefore = await testPrisma.liability.count();
      const snapshotsBefore = await testPrisma.wealthSnapshot.count();
      const challengesBefore = await testPrisma.challenge.count();

      await get('/api/admin/system-health', tokenAdmin);
      await get('/api/admin/system-health', tokenAdmin);

      expect(await testPrisma.asset.count()).toBe(assetsBefore);
      expect(await testPrisma.liability.count()).toBe(liabilitiesBefore);
      expect(await testPrisma.wealthSnapshot.count()).toBe(snapshotsBefore);
      expect(await testPrisma.challenge.count()).toBe(challengesBefore);
    });
  });

  describe('runtime information', () => {
    it('reports numeric uptimes', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      const { application, runtime } = res.body.data;
      expect(typeof application.uptimeSeconds).toBe('number');
      expect(application.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(typeof runtime.uptimeSeconds).toBe('number');
      expect(runtime.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('reports numeric memory summaries', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      const { rssMb, heapUsedMb, heapTotalMb } = res.body.data.runtime.memory;
      for (const value of [rssMb, heapUsedMb, heapTotalMb]) {
        expect(typeof value).toBe('number');
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
      expect(heapUsedMb).toBeLessThanOrEqual(heapTotalMb + 1);
    });

    it('reports a major.minor Node version', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      const { nodeVersion } = res.body.data.runtime;
      expect(nodeVersion).toMatch(/^\d+\.\d+$/);
    });

    it('derives a valid runtime status', async () => {
      const res = await get('/api/admin/system-health', tokenAdmin);
      expect(['HEALTHY', 'DEGRADED']).toContain(res.body.data.runtime.status);
    });
  });

  describe('overall status aggregation', () => {
    const base = {
      application: { status: 'HEALTHY' as const },
      database: { status: 'HEALTHY' as const },
      runtime: { status: 'HEALTHY' as const },
    };

    it('is HEALTHY when every component is healthy', () => {
      expect(deriveOverallStatus(base)).toBe('HEALTHY');
    });

    it('is DEGRADED when only the runtime is degraded', () => {
      expect(
        deriveOverallStatus({ ...base, runtime: { status: 'DEGRADED' } })
      ).toBe('DEGRADED');
    });

    it('is UNHEALTHY when the critical database component is unhealthy', () => {
      expect(
        deriveOverallStatus({ ...base, database: { status: 'UNHEALTHY' } })
      ).toBe('UNHEALTHY');
    });

    it('prefers UNHEALTHY over DEGRADED', () => {
      expect(
        deriveOverallStatus({
          application: { status: 'HEALTHY' },
          database: { status: 'UNHEALTHY' },
          runtime: { status: 'DEGRADED' },
        })
      ).toBe('UNHEALTHY');
    });
  });
});
