import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { AccountStatus, Role } from '@prisma/client';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import adminUserRoutes from '../src/routes/adminUserRoutes.js';
import adminAuditLogRoutes from '../src/routes/adminAuditLogRoutes.js';

interface TestUser {
  id: string;
  email: string;
  password: string;
}

function isoDayOffset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

describe('Admin audit log API', () => {
  let app: express.Express;
  let admin: TestUser;
  let userA: TestUser;
  let userB: TestUser;
  let tokenAdmin: string;
  let tokenA: string;

  async function createUser(
    role: Role,
    status: AccountStatus,
    overrides: Record<string, string> = {}
  ): Promise<TestUser> {
    const draft = createTestUser();
    const created = await testPrisma.user.create({
      data: {
        email: overrides.email ?? draft.email,
        passwordHash: await hashPassword(draft.password),
        firstName: overrides.firstName ?? draft.firstName,
        lastName: overrides.lastName ?? draft.lastName,
        role,
        status,
      },
    });
    return { id: created.id, email: created.email, password: draft.password };
  }

  beforeEach(async () => {
    await testPrisma.auditLog.deleteMany();

    admin = await createUser(Role.ADMIN, AccountStatus.ACTIVE, {
      firstName: 'Ada',
      lastName: 'Admin',
    });
    userA = await createUser(Role.USER, AccountStatus.ACTIVE, {
      firstName: 'Alice',
      lastName: 'Anderson',
    });
    userB = await createUser(Role.USER, AccountStatus.ACTIVE, {
      firstName: 'Bob',
      lastName: 'Baker',
    });

    tokenAdmin = authService.generateAccessToken({
      id: admin.id,
      role: Role.ADMIN,
    });
    tokenA = authService.generateAccessToken({ id: userA.id, role: Role.USER });

    app = express();
    app.use(express.json());
    app.use('/api/admin', adminUserRoutes);
    app.use('/api/admin', adminAuditLogRoutes);
    app.use(errorHandler);
  });

  function get(url: string, token?: string) {
    const req = request(app).get(url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  function patch(url: string, token?: string) {
    const req = request(app).patch(url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  async function seedAuditLog(
    overrides: Record<string, unknown> = {}
  ): Promise<{ id: string; createdAt: Date }> {
    return testPrisma.auditLog.create({
      data: {
        actorUserId: admin.id,
        action: 'ADMIN_USER_STATUS_CHANGED',
        entityType: 'User',
        entityId: userA.id,
        metadata: {
          targetUserId: userA.id,
          from: 'ACTIVE',
          to: 'SUSPENDED',
          revokedSessions: 2,
        },
        ...overrides,
      },
      select: { id: true, createdAt: true },
    });
  }

  describe('authorization', () => {
    it('rejects anonymous requests with 401', async () => {
      const res = await get('/api/admin/audit-logs');
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHORIZED');
    });

    it('rejects a normal USER with 403', async () => {
      const res = await get('/api/admin/audit-logs', tokenA);
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    });

    it('allows an ADMIN with 200 and a paginated shape', async () => {
      await seedAuditLog();
      const res = await get('/api/admin/audit-logs', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.auditLogs)).toBe(true);
      expect(res.body.data.auditLogs).toHaveLength(1);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(20);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.totalPages).toBe(1);
    });
  });

  describe('spoofing', () => {
    it('ignores a spoofed X-User-Role header', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-User-Role', 'ADMIN');
      expect(res.status).toBe(403);
    });

    it('ignores a spoofed X-User-Id header', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-User-Id', admin.id);
      expect(res.status).toBe(403);
    });

    it('cannot bypass authorization with a ?role= query parameter', async () => {
      const res = await get('/api/admin/audit-logs?role=ADMIN', tokenA);
      expect(res.status).toBe(403);
    });

    it('cannot bypass authorization with body values', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ role: 'ADMIN', actorUserId: admin.id });
      expect(res.status).toBe(403);
    });

    it('rejects unknown query parameters even for an ADMIN', async () => {
      const res = await get('/api/admin/audit-logs?role=ADMIN', tokenAdmin);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('validation', () => {
    async function expect400(query: string) {
      const res = await get(`/api/admin/audit-logs${query}`, tokenAdmin);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
      return res;
    }

    it('rejects page < 1', async () => {
      await expect400('?page=0');
    });

    it('rejects a non-numeric page', async () => {
      await expect400('?page=abc');
    });

    it('rejects pageSize < 1', async () => {
      await expect400('?pageSize=0');
    });

    it('rejects pageSize > 50', async () => {
      await expect400('?pageSize=51');
    });

    it('rejects unknown query parameters', async () => {
      await expect400('?foo=bar');
    });

    it('rejects an invalid action', async () => {
      await expect400('?action=NOT_A_REAL_ACTION');
    });

    it('rejects an invalid dateFrom', async () => {
      await expect400('?dateFrom=not-a-date');
    });

    it('rejects an invalid dateTo', async () => {
      await expect400('?dateTo=2026-13-45');
    });

    it('rejects a reversed date range', async () => {
      await expect400(`?dateFrom=${isoDayOffset(2)}&dateTo=${isoDayOffset(1)}`);
    });

    it('rejects an unbounded date range', async () => {
      await expect400('?dateFrom=2000-01-01&dateTo=2026-01-01');
    });
  });

  describe('pagination and ordering', () => {
    let seeds: { id: string; createdAt: Date }[];

    beforeEach(async () => {
      seeds = [];
      for (let i = 0; i < 5; i += 1) {
        seeds.push(
          await seedAuditLog({ createdAt: new Date(Date.now() - i * 60_000) })
        );
      }
    });

    it('returns page 1 newest first', async () => {
      const res = await get('/api/admin/audit-logs?page=1&pageSize=2', tokenAdmin);
      expect(res.status).toBe(200);
      const items = res.body.data.auditLogs;
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe(seeds[0].id);
      expect(items[1].id).toBe(seeds[1].id);
      expect(res.body.data.total).toBe(5);
      expect(res.body.data.totalPages).toBe(3);
    });

    it('returns page 2 with the next items', async () => {
      const res = await get('/api/admin/audit-logs?page=2&pageSize=2', tokenAdmin);
      expect(res.status).toBe(200);
      const items = res.body.data.auditLogs;
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe(seeds[2].id);
      expect(items[1].id).toBe(seeds[3].id);
      expect(res.body.data.page).toBe(2);
    });

    it('honours a pageSize of 1', async () => {
      const res = await get('/api/admin/audit-logs?pageSize=1', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.data.auditLogs).toHaveLength(1);
      expect(res.body.data.pageSize).toBe(1);
      expect(res.body.data.totalPages).toBe(5);
    });

    it('orders strictly newest first by createdAt', async () => {
      const res = await get('/api/admin/audit-logs?pageSize=50', tokenAdmin);
      const items = res.body.data.auditLogs as { createdAt: string }[];
      for (let i = 1; i < items.length; i += 1) {
        expect(Date.parse(items[i].createdAt)).toBeLessThanOrEqual(
          Date.parse(items[i - 1].createdAt)
        );
      }
      expect(items[0].id).toBe(seeds[0].id);
    });

    it('reports the correct total count', async () => {
      const res = await get('/api/admin/audit-logs?pageSize=50', tokenAdmin);
      expect(res.body.data.total).toBe(5);
      expect(res.body.data.auditLogs).toHaveLength(5);
    });
  });

  describe('filtering', () => {
    beforeEach(async () => {
      await seedAuditLog({
        action: 'ADMIN_USER_STATUS_CHANGED',
        entityId: userA.id,
        createdAt: new Date(Date.now() - 60_000),
      });
      await seedAuditLog({
        action: 'ADMIN_USER_STATUS_CHANGED',
        entityId: userA.id,
        createdAt: new Date(Date.now() - 120_000),
      });
      await seedAuditLog({
        action: 'ADMIN_USER_ROLE_CHANGED',
        entityId: userB.id,
        metadata: { targetUserId: userB.id, from: 'USER', to: 'ADMIN' },
        createdAt: new Date(Date.now() - 180_000),
      });
      await seedAuditLog({
        action: 'ADMIN_USER_ROLE_CHANGED',
        entityId: userB.id,
        actorUserId: userA.id,
        metadata: { targetUserId: userB.id, from: 'ADMIN', to: 'USER' },
        createdAt: new Date(Date.now() - 240_000),
      });
      await seedAuditLog({
        actorUserId: admin.id,
        entityId: userA.id,
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      });
    });

    it('filters by action', async () => {
      const res = await get(
        '/api/admin/audit-logs?action=ADMIN_USER_ROLE_CHANGED&pageSize=50',
        tokenAdmin
      );
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
      expect(
        res.body.data.auditLogs.every(
          (log: { action: string }) => log.action === 'ADMIN_USER_ROLE_CHANGED'
        )
      ).toBe(true);
    });

    it('filters by actorUserId', async () => {
      const res = await get(
        `/api/admin/audit-logs?actorUserId=${userA.id}`,
        tokenAdmin
      );
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.auditLogs[0].actor.id).toBe(userA.id);
    });

    it('filters by target entity id', async () => {
      const res = await get(
        `/api/admin/audit-logs?entityId=${userB.id}`,
        tokenAdmin
      );
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
      expect(
        res.body.data.auditLogs.every(
          (log: { entityId: string }) => log.entityId === userB.id
        )
      ).toBe(true);
    });

    it('filters by date range using UTC calendar days', async () => {
      const today = await get(
        `/api/admin/audit-logs?dateFrom=${isoDayOffset(0)}`,
        tokenAdmin
      );
      expect(today.status).toBe(200);
      expect(today.body.data.total).toBe(4);

      const past = await get(
        `/api/admin/audit-logs?dateFrom=${isoDayOffset(-11)}&dateTo=${isoDayOffset(-1)}`,
        tokenAdmin
      );
      expect(past.status).toBe(200);
      expect(past.body.data.total).toBe(1);
      expect(past.body.data.auditLogs[0].createdAt.startsWith(
        new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      )).toBe(true);
    });

    it('searches by actor email', async () => {
      const res = await get(
        `/api/admin/audit-logs?search=${encodeURIComponent(admin.email)}`,
        tokenAdmin
      );
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(4);
    });

    it('searches by target email', async () => {
      const res = await get(
        `/api/admin/audit-logs?search=${encodeURIComponent(userB.email)}`,
        tokenAdmin
      );
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
      expect(
        res.body.data.auditLogs.every(
          (log: { target: { email: string } | null }) =>
            log.target?.email === userB.email
        )
      ).toBe(true);
    });

    it('searches by action substring', async () => {
      const res = await get('/api/admin/audit-logs?search=ROLE_CHANGED', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
    });

    it('returns an empty page when search matches nothing', async () => {
      const res = await get(
        '/api/admin/audit-logs?search=zzz-no-such-user',
        tokenAdmin
      );
      expect(res.status).toBe(200);
      expect(res.body.data.auditLogs).toEqual([]);
      expect(res.body.data.total).toBe(0);
    });
  });

  describe('data safety', () => {
    it('never exposes credentials, tokens, cookies or secrets', async () => {
      await testPrisma.transaction.create({
        data: {
          userId: userA.id,
          categoryId: (
            await testPrisma.category.create({
              data: { userId: userA.id, name: 'General', type: 'EXPENSE' },
            })
          ).id,
          type: 'EXPENSE',
          amount: 12345.67,
          transactionDate: new Date(),
        },
      });

      await seedAuditLog({
        metadata: {
          passwordHash: 'HASH_SECRET_VALUE',
          refreshTokenHash: 'RT_HASH_SECRET_VALUE',
          previousRefreshTokenHash: 'PREV_RT_SECRET_VALUE',
          nested: { accessToken: 'ACCESS_SECRET_VALUE', keep: 'kept-value' },
          cookie: 'wh_refresh_token=SECRET_COOKIE_VALUE',
          longString: 'x'.repeat(2000),
          bigArray: Array.from({ length: 100 }, (_, index) => index),
          ok: 42,
        },
      });

      const res = await get('/api/admin/audit-logs', tokenAdmin);
      expect(res.status).toBe(200);
      const raw = JSON.stringify(res.body);

      expect(raw).not.toContain('HASH_SECRET_VALUE');
      expect(raw).not.toContain('RT_HASH_SECRET_VALUE');
      expect(raw).not.toContain('PREV_RT_SECRET_VALUE');
      expect(raw).not.toContain('ACCESS_SECRET_VALUE');
      expect(raw).not.toContain('SECRET_COOKIE_VALUE');
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('refreshTokenHash');
      expect(raw).not.toContain('previousRefreshTokenHash');
      expect(raw).not.toContain('accessToken');
      expect(raw).not.toContain('"password"');
      expect(raw).not.toContain('12345.67');

      const metadata = res.body.data.auditLogs[0].metadata;
      expect(metadata.nested.keep).toBe('kept-value');
      expect(metadata.nested.accessToken).toBeUndefined();
      expect(metadata.ok).toBe(42);
      expect(metadata.longString.length).toBeLessThanOrEqual(503);
      expect(metadata.bigArray).toHaveLength(50);
    });

    it('exposes only the safe response contract per entry', async () => {
      await seedAuditLog();
      const res = await get('/api/admin/audit-logs', tokenAdmin);
      const item = res.body.data.auditLogs[0];
      expect(Object.keys(item).sort()).toEqual([
        'action',
        'actor',
        'createdAt',
        'entityId',
        'entityType',
        'id',
        'metadata',
        'target',
      ]);
      expect(Object.keys(item.actor).sort()).toEqual([
        'email',
        'firstName',
        'id',
        'lastName',
      ]);
    });
  });

  describe('immutability', () => {
    it('has no DELETE endpoint', async () => {
      const seed = await seedAuditLog();
      const bare = await request(app)
        .delete('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(bare.status).toBe(404);
      const byId = await request(app)
        .delete(`/api/admin/audit-logs/${seed.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(byId.status).toBe(404);
      expect(await testPrisma.auditLog.count()).toBe(1);
    });

    it('has no PATCH or PUT endpoint', async () => {
      const seed = await seedAuditLog();
      const patchRes = await request(app)
        .patch(`/api/admin/audit-logs/${seed.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ action: 'TAMPERED' });
      expect(patchRes.status).toBe(404);
      const putRes = await request(app)
        .put(`/api/admin/audit-logs/${seed.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ action: 'TAMPERED' });
      expect(putRes.status).toBe(404);
      const row = await testPrisma.auditLog.findUnique({
        where: { id: seed.id },
      });
      expect(row?.action).toBe('ADMIN_USER_STATUS_CHANGED');
    });

    it('has no POST endpoint and GET performs no mutation', async () => {
      const seed = await seedAuditLog();
      const before = await testPrisma.auditLog.count();
      const postRes = await request(app)
        .post('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ action: 'FORGED', entityType: 'User' });
      expect(postRes.status).toBe(404);

      await get('/api/admin/audit-logs', tokenAdmin);
      await get(`/api/admin/audit-logs?action=${seed.action}`, tokenAdmin);
      expect(await testPrisma.auditLog.count()).toBe(before);
    });
  });

  describe('existing 5F-3 audit events', () => {
    it('queries status-change and role-change events written by admin mutations', async () => {
      const suspend = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'SUSPENDED',
      });
      expect(suspend.status).toBe(200);

      const promote = await patch(`/api/admin/users/${userB.id}/role`, tokenAdmin).send({
        role: 'ADMIN',
      });
      expect(promote.status).toBe(200);

      const res = await get('/api/admin/audit-logs', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);

      const items = res.body.data.auditLogs;
      expect(items[0].action).toBe('ADMIN_USER_ROLE_CHANGED');
      expect(items[1].action).toBe('ADMIN_USER_STATUS_CHANGED');

      const statusEvent = items[1];
      expect(statusEvent.actor).toEqual({
        id: admin.id,
        email: admin.email,
        firstName: 'Ada',
        lastName: 'Admin',
      });
      expect(statusEvent.target).toEqual({
        id: userA.id,
        email: userA.email,
        firstName: 'Alice',
        lastName: 'Anderson',
      });
      expect(statusEvent.entityType).toBe('User');
      expect(statusEvent.entityId).toBe(userA.id);
      expect(statusEvent.metadata).toMatchObject({
        targetUserId: userA.id,
        from: 'ACTIVE',
        to: 'SUSPENDED',
      });
      expect(typeof statusEvent.metadata.revokedSessions).toBe('number');

      const roleEvent = items[0];
      expect(roleEvent.actor.id).toBe(admin.id);
      expect(roleEvent.target.id).toBe(userB.id);
      expect(roleEvent.metadata).toMatchObject({
        targetUserId: userB.id,
        from: 'USER',
        to: 'ADMIN',
      });
    });
  });

  describe('isolation and robustness', () => {
    it('tolerates a missing actor and a missing target', async () => {
      await testPrisma.auditLog.create({
        data: {
          actorUserId: null,
          action: 'ADMIN_USER_STATUS_CHANGED',
          entityType: 'User',
          entityId: null,
          metadata: null,
        },
      });
      await testPrisma.auditLog.create({
        data: {
          actorUserId: admin.id,
          action: 'ADMIN_USER_STATUS_CHANGED',
          entityType: 'User',
          entityId: 'cmissingtarget000000000',
          metadata: null,
        },
      });

      const res = await get('/api/admin/audit-logs', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
      const withoutActor = res.body.data.auditLogs.find(
        (log: { actor: unknown }) => log.actor === null
      );
      expect(withoutActor).toBeDefined();
      expect(withoutActor.target).toBeNull();
      const missingTarget = res.body.data.auditLogs.find(
        (log: { entityId: string | null }) => log.entityId === 'cmissingtarget000000000'
      );
      expect(missingTarget.actor.id).toBe(admin.id);
      expect(missingTarget.target).toBeNull();
      expect(missingTarget.metadata).toBeNull();
    });

    it('returns an empty page when nothing matches', async () => {
      const res = await get('/api/admin/audit-logs', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.data.auditLogs).toEqual([]);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.totalPages).toBe(1);
    });

    it('rejects malformed actor and target ids', async () => {
      const actor = await get('/api/admin/audit-logs?actorUserId=notanid', tokenAdmin);
      expect(actor.status).toBe(400);
      const entity = await get('/api/admin/audit-logs?entityId=%21%21%21', tokenAdmin);
      expect(entity.status).toBe(400);
    });
  });
});
