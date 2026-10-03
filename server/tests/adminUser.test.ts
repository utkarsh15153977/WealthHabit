import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { AccountStatus, Prisma, Role } from '@prisma/client';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { lockAdminUserMutations } from '../src/services/adminUserService.js';
import { env } from '../src/config/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import adminUserRoutes from '../src/routes/adminUserRoutes.js';
import authRoutes from '../src/routes/authRoutes.js';
import userRoutes from '../src/routes/userRoutes.js';

interface TestUser {
  id: string;
  email: string;
  password: string;
}

describe('Admin user management API', () => {
  let app: express.Express;
  let admin: TestUser;
  let userA: TestUser;
  let userB: TestUser;
  let tokenAdmin: string;
  let tokenA: string;
  let tokenB: string;

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
    tokenB = authService.generateAccessToken({ id: userB.id, role: Role.USER });

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/admin', adminUserRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/users', userRoutes);
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

  async function createSessionFor(userId: string): Promise<string> {
    const raw = `refresh-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    await testPrisma.session.create({
      data: {
        userId,
        refreshTokenHash: authService.hashRefreshToken(raw),
        previousRefreshTokenHash: null,
        tokenFamilyId: `family-${Math.random().toString(36).slice(2)}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    return raw;
  }

  async function seedFinancialRecords(userId: string): Promise<void> {
    const category = await testPrisma.category.create({
      data: { userId, name: 'General', type: 'EXPENSE' },
    });
    await testPrisma.transaction.create({
      data: {
        userId,
        categoryId: category.id,
        type: 'EXPENSE',
        amount: 1234.56,
        transactionDate: new Date(),
      },
    });
    await testPrisma.savingsGoal.create({
      data: {
        userId,
        name: 'Emergency fund',
        targetAmount: 5000,
        targetDate: new Date('2027-01-01'),
        category: 'general',
      },
    });
    await testPrisma.asset.create({
      data: { userId, name: 'Checking', type: 'CASH', currentValue: 2500 },
    });
    await testPrisma.liability.create({
      data: {
        userId,
        name: 'Card',
        type: 'CREDIT_CARD',
        outstandingAmount: 750,
      },
    });
    await testPrisma.financialHabit.create({
      data: {
        userId,
        name: 'Track daily expenses',
        frequency: 'DAILY',
        startDate: new Date(),
      },
    });
  }

  describe('authentication', () => {
    it('rejects anonymous list requests with 401', async () => {
      const res = await get('/api/admin/users');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects anonymous detail requests with 401', async () => {
      const res = await get(`/api/admin/users/${userA.id}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects anonymous status mutations with 401', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/status`).send({
        status: 'SUSPENDED',
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects anonymous role mutations with 401', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/role`).send({
        role: 'ADMIN',
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('authorization', () => {
    it('rejects USER list requests with 403', async () => {
      const res = await get('/api/admin/users', tokenA);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects USER detail requests with 403', async () => {
      const res = await get(`/api/admin/users/${userA.id}`, tokenA);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects USER status mutations with 403', async () => {
      const res = await patch(`/api/admin/users/${userB.id}/status`, tokenA).send({
        status: 'SUSPENDED',
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects USER role mutations with 403', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/role`, tokenA).send({
        role: 'ADMIN',
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('still rejects suspended administrators with 403', async () => {
      await testPrisma.user.update({
        where: { id: admin.id },
        data: { status: AccountStatus.SUSPENDED },
      });
      const res = await get('/api/admin/users', tokenAdmin);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('spoofing resistance', () => {
    it('ignores X-User-Role header spoofing', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-User-Role', 'ADMIN');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('ignores X-User-Id header spoofing', async () => {
      const res = await request(app)
        .get(`/api/admin/users/${admin.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-User-Id', admin.id);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects ?role=ADMIN query spoofing for non-admins', async () => {
      const res = await get('/api/admin/users?role=ADMIN', tokenA);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects body mass assignment on status updates', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'SUSPENDED',
        role: 'ADMIN',
        userId: userA.id,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const user = await testPrisma.user.findUnique({ where: { id: userA.id } });
      expect(user?.status).toBe(AccountStatus.ACTIVE);
      expect(user?.role).toBe(Role.USER);
    });

    it('rejects extra fields on role updates', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/role`, tokenAdmin).send({
        role: 'ADMIN',
        userId: userA.id,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const user = await testPrisma.user.findUnique({ where: { id: userA.id } });
      expect(user?.role).toBe(Role.USER);
    });

    it('does not let a normal user escalate through the profile API', async () => {
      const res = await request(app)
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ role: 'ADMIN', status: 'ACTIVE' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const user = await testPrisma.user.findUnique({ where: { id: userA.id } });
      expect(user?.role).toBe(Role.USER);
    });
  });

  describe('validation', () => {
    it('rejects page values below 1', async () => {
      const res = await get('/api/admin/users?page=0', tokenAdmin);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects pageSize above 50', async () => {
      const res = await get('/api/admin/users?pageSize=51', tokenAdmin);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unexpected query parameters', async () => {
      const res = await get('/api/admin/users?foo=bar', tokenAdmin);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unknown role filter values', async () => {
      const res = await get('/api/admin/users?role=SUPERADMIN', tokenAdmin);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unknown status filter values', async () => {
      const res = await get('/api/admin/users?status=BANNED', tokenAdmin);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid status values', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'BANNED',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an empty status body', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a missing status body', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid role values', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/role`, tokenAdmin).send({
        role: 'SUPERADMIN',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an empty role body', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/role`, tokenAdmin).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 for a malformed user id', async () => {
      const res = await get('/api/admin/users/not-a-real-id', tokenAdmin);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('returns 404 for a nonexistent user id', async () => {
      const res = await get('/api/admin/users/cdoesnotexist00000000000', tokenAdmin);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('returns 404 when mutating a nonexistent user', async () => {
      const res = await patch(
        '/api/admin/users/cdoesnotexist00000000000/status',
        tokenAdmin
      ).send({ status: 'SUSPENDED' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('user list', () => {
    it('returns safe list items with pagination metadata', async () => {
      const res = await get('/api/admin/users', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users).toHaveLength(3);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(20);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.totalPages).toBe(1);

      const item = res.body.data.users[0];
      expect(Object.keys(item).sort()).toEqual(
        [
          'createdAt',
          'email',
          'firstName',
          'id',
          'lastLoginAt',
          'lastName',
          'role',
          'status',
          'updatedAt',
        ].sort()
      );
    });

    it('paginates results', async () => {
      const page1 = await get('/api/admin/users?page=1&pageSize=2', tokenAdmin);
      expect(page1.status).toBe(200);
      expect(page1.body.data.users).toHaveLength(2);
      expect(page1.body.data.total).toBe(3);
      expect(page1.body.data.totalPages).toBe(2);

      const page2 = await get('/api/admin/users?page=2&pageSize=2', tokenAdmin);
      expect(page2.status).toBe(200);
      expect(page2.body.data.users).toHaveLength(1);
      expect(page2.body.data.page).toBe(2);
    });

    it('searches by email', async () => {
      const res = await get(
        `/api/admin/users?search=${encodeURIComponent(userA.email)}`,
        tokenAdmin
      );
      expect(res.status).toBe(200);
      expect(res.body.data.users).toHaveLength(1);
      expect(res.body.data.users[0].id).toBe(userA.id);
    });

    it('searches by name', async () => {
      const res = await get('/api/admin/users?search=Alice', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.data.users).toHaveLength(1);
      expect(res.body.data.users[0].id).toBe(userA.id);
    });

    it('filters by role', async () => {
      const res = await get('/api/admin/users?role=ADMIN', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.data.users).toHaveLength(1);
      expect(res.body.data.users[0].id).toBe(admin.id);
      expect(res.body.data.users[0].role).toBe('ADMIN');
    });

    it('filters by account status', async () => {
      await testPrisma.user.update({
        where: { id: userA.id },
        data: { status: AccountStatus.SUSPENDED },
      });
      const res = await get('/api/admin/users?status=SUSPENDED', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.data.users).toHaveLength(1);
      expect(res.body.data.users[0].id).toBe(userA.id);
    });

    it('never returns credentials in list responses', async () => {
      const res = await get('/api/admin/users', tokenAdmin);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('refreshTokenHash');
      expect(raw).not.toContain('previousRefreshTokenHash');
      expect(raw).not.toContain('tokenHash');
    });
  });

  describe('user detail', () => {
    it('returns safe user details with operational counts only', async () => {
      await seedFinancialRecords(userA.id);

      const res = await get(`/api/admin/users/${userA.id}`, tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(userA.id);
      expect(res.body.data.user.email).toBe(userA.email);
      expect(res.body.data.user.role).toBe('USER');
      expect(res.body.data.user.status).toBe('ACTIVE');
      expect(res.body.data.counts).toEqual({
        transactions: 1,
        goals: 1,
        assets: 1,
        liabilities: 1,
        habits: 1,
        challenges: 0,
      });

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('1234.56');
      expect(raw).not.toContain('"amount"');
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('refreshTokenHash');
      expect(raw).not.toContain('targetAmount');
      expect(raw).not.toContain('currentValue');
      expect(raw).not.toContain('outstandingAmount');
    });

    it('does not leak whether authentication records exist', async () => {
      await createSessionFor(userA.id);
      const res = await get(`/api/admin/users/${userA.id}`, tokenAdmin);
      expect(res.status).toBe(200);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('session');
      expect(raw).not.toContain('refresh');
    });
  });

  describe('status management', () => {
    it('suspends an active user', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'SUSPENDED',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.status).toBe('SUSPENDED');
      const user = await testPrisma.user.findUnique({ where: { id: userA.id } });
      expect(user?.status).toBe(AccountStatus.SUSPENDED);
    });

    it('reactivates a suspended user', async () => {
      await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'SUSPENDED',
      });
      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'ACTIVE',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.status).toBe('ACTIVE');
    });

    it('deactivates an active user', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'DEACTIVATED',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.status).toBe('DEACTIVATED');
    });

    it('reactivates a deactivated user', async () => {
      await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'DEACTIVATED',
      });
      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'ACTIVE',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.status).toBe('ACTIVE');
    });

    it('rejects unsupported DEACTIVATED to SUSPENDED transitions', async () => {
      await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'DEACTIVATED',
      });
      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'SUSPENDED',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      const user = await testPrisma.user.findUnique({ where: { id: userA.id } });
      expect(user?.status).toBe(AccountStatus.DEACTIVATED);
    });

    it('allows idempotent same-status updates', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'ACTIVE',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.status).toBe('ACTIVE');
    });
  });

  describe('session invalidation', () => {
    it('blocks and revokes sessions when a user is suspended', async () => {
      const before = await get('/api/users/me', tokenA);
      expect(before.status).toBe(200);

      const rawRefresh = await createSessionFor(userA.id);

      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'SUSPENDED',
      });
      expect(res.status).toBe(200);

      const sessions = await testPrisma.session.findMany({
        where: { userId: userA.id },
      });
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);

      const blocked = await get('/api/users/me', tokenA);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('ACCOUNT_SUSPENDED');

      const refresh = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `${env.COOKIE_NAME}=${rawRefresh}`);
      expect(refresh.status).toBe(401);
      expect(refresh.body.error.code).toBe('TOKEN_REVOKED');
    });

    it('blocks and revokes sessions when a user is deactivated', async () => {
      const rawRefresh = await createSessionFor(userA.id);

      const res = await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'DEACTIVATED',
      });
      expect(res.status).toBe(200);

      const sessions = await testPrisma.session.findMany({
        where: { userId: userA.id },
      });
      expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);

      const blocked = await get('/api/users/me', tokenA);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('ACCOUNT_DEACTIVATED');

      const refresh = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `${env.COOKIE_NAME}=${rawRefresh}`);
      expect(refresh.status).toBe(401);
      expect(refresh.body.error.code).toBe('TOKEN_REVOKED');
    });

    it('allows a reactivated user to authenticate again', async () => {
      await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'SUSPENDED',
      });
      await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'ACTIVE',
      });

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: userA.email, password: userA.password });
      expect(login.status).toBe(200);
      expect(login.body.data.accessToken).toBeTruthy();

      const me = await get('/api/users/me', login.body.data.accessToken);
      expect(me.status).toBe(200);
    });
  });

  describe('role management', () => {
    it('promotes a user to administrator', async () => {
      const res = await patch(`/api/admin/users/${userB.id}/role`, tokenAdmin).send({
        role: 'ADMIN',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe('ADMIN');
      const user = await testPrisma.user.findUnique({ where: { id: userB.id } });
      expect(user?.role).toBe(Role.ADMIN);
    });

    it('demotes an administrator when another administrator remains', async () => {
      await patch(`/api/admin/users/${userB.id}/role`, tokenAdmin).send({
        role: 'ADMIN',
      });

      const res = await patch(`/api/admin/users/${userB.id}/role`, tokenAdmin).send({
        role: 'USER',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe('USER');
    });

    it('allows idempotent same-role updates', async () => {
      const res = await patch(`/api/admin/users/${userB.id}/role`, tokenAdmin).send({
        role: 'USER',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe('USER');
    });

    it('applies role changes immediately for subsequent requests', async () => {
      await patch(`/api/admin/users/${userB.id}/role`, tokenAdmin).send({
        role: 'ADMIN',
      });
      const asAdmin = await get('/api/admin/users', tokenB);
      expect(asAdmin.status).toBe(200);

      await patch(`/api/admin/users/${userB.id}/role`, tokenAdmin).send({
        role: 'USER',
      });
      const asUser = await get('/api/admin/users', tokenB);
      expect(asUser.status).toBe(403);
    });
  });

  describe('self-protection and last-admin protection', () => {
    it('prevents an administrator from suspending themselves', async () => {
      const res = await patch(`/api/admin/users/${admin.id}/status`, tokenAdmin).send({
        status: 'SUSPENDED',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ADMIN_SELF_STATUS_CHANGE');
      const user = await testPrisma.user.findUnique({ where: { id: admin.id } });
      expect(user?.status).toBe(AccountStatus.ACTIVE);
    });

    it('prevents an administrator from deactivating themselves', async () => {
      const res = await patch(`/api/admin/users/${admin.id}/status`, tokenAdmin).send({
        status: 'DEACTIVATED',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ADMIN_SELF_STATUS_CHANGE');
      const user = await testPrisma.user.findUnique({ where: { id: admin.id } });
      expect(user?.status).toBe(AccountStatus.ACTIVE);
    });

    it('prevents the last administrator from demoting themselves', async () => {
      const res = await patch(`/api/admin/users/${admin.id}/role`, tokenAdmin).send({
        role: 'USER',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_ADMIN_REQUIRED');
      const user = await testPrisma.user.findUnique({ where: { id: admin.id } });
      expect(user?.role).toBe(Role.ADMIN);
    });

    it('allows demoting one of two administrators, then blocks the last one', async () => {
      const secondAdmin = await createUser(Role.ADMIN, AccountStatus.ACTIVE, {
        firstName: 'Second',
        lastName: 'Admin',
      });
      const secondToken = authService.generateAccessToken({
        id: secondAdmin.id,
        role: Role.ADMIN,
      });

      const demoteFirst = await patch(
        `/api/admin/users/${admin.id}/role`,
        secondToken
      ).send({ role: 'USER' });
      expect(demoteFirst.status).toBe(200);
      expect(demoteFirst.body.data.user.role).toBe('USER');

      const demoteLast = await patch(
        `/api/admin/users/${secondAdmin.id}/role`,
        secondToken
      ).send({ role: 'USER' });
      expect(demoteLast.status).toBe(409);
      expect(demoteLast.body.error.code).toBe('LAST_ADMIN_REQUIRED');

      const survivor = await testPrisma.user.findUnique({
        where: { id: secondAdmin.id },
      });
      expect(survivor?.role).toBe(Role.ADMIN);
    });

    it('allows self-demotion once another active administrator exists', async () => {
      await patch(`/api/admin/users/${userB.id}/role`, tokenAdmin).send({
        role: 'ADMIN',
      });

      const res = await patch(`/api/admin/users/${admin.id}/role`, tokenAdmin).send({
        role: 'USER',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe('USER');
    });

    it('does not let a normal user promote themselves', async () => {
      const res = await patch(`/api/admin/users/${userA.id}/role`, tokenA).send({
        role: 'ADMIN',
      });
      expect(res.status).toBe(403);
      const user = await testPrisma.user.findUnique({ where: { id: userA.id } });
      expect(user?.role).toBe(Role.USER);
    });
  });

  describe('data safety and audit logging', () => {
    it('never deletes financial records when the status changes', async () => {
      await seedFinancialRecords(userA.id);

      const before = {
        transactions: await testPrisma.transaction.count({ where: { userId: userA.id } }),
        goals: await testPrisma.savingsGoal.count({ where: { userId: userA.id } }),
        assets: await testPrisma.asset.count({ where: { userId: userA.id } }),
        liabilities: await testPrisma.liability.count({ where: { userId: userA.id } }),
        habits: await testPrisma.financialHabit.count({ where: { userId: userA.id } }),
        categories: await testPrisma.category.count({ where: { userId: userA.id } }),
      };

      await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'SUSPENDED',
      });
      await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'DEACTIVATED',
      });

      const after = {
        transactions: await testPrisma.transaction.count({ where: { userId: userA.id } }),
        goals: await testPrisma.savingsGoal.count({ where: { userId: userA.id } }),
        assets: await testPrisma.asset.count({ where: { userId: userA.id } }),
        liabilities: await testPrisma.liability.count({ where: { userId: userA.id } }),
        habits: await testPrisma.financialHabit.count({ where: { userId: userA.id } }),
        categories: await testPrisma.category.count({ where: { userId: userA.id } }),
      };

      expect(after).toEqual(before);
    });

    it('records an audit entry for status changes without secrets', async () => {
      await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'SUSPENDED',
      });

      const entries = await testPrisma.auditLog.findMany({
        where: { action: 'ADMIN_USER_STATUS_CHANGED' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].actorUserId).toBe(admin.id);
      expect(entries[0].entityType).toBe('User');
      expect(entries[0].entityId).toBe(userA.id);
      expect(entries[0].metadata).toMatchObject({
        targetUserId: userA.id,
        from: 'ACTIVE',
        to: 'SUSPENDED',
      });

      const raw = JSON.stringify(entries);
      expect(raw).not.toContain('password');
      expect(raw).not.toContain('token');
      expect(raw).not.toContain('secret');
    });

    it('records an audit entry for role changes without secrets', async () => {
      await patch(`/api/admin/users/${userB.id}/role`, tokenAdmin).send({
        role: 'ADMIN',
      });

      const entries = await testPrisma.auditLog.findMany({
        where: { action: 'ADMIN_USER_ROLE_CHANGED' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].actorUserId).toBe(admin.id);
      expect(entries[0].entityId).toBe(userB.id);
      expect(entries[0].metadata).toMatchObject({ from: 'USER', to: 'ADMIN' });

      const raw = JSON.stringify(entries);
      expect(raw).not.toContain('password');
      expect(raw).not.toContain('refreshToken');
    });

    it('performs no writes on read-only GET operations', async () => {
      await get('/api/admin/users', tokenAdmin);
      await get('/api/admin/users?search=Alice&role=USER', tokenAdmin);
      await get(`/api/admin/users/${userA.id}`, tokenAdmin);

      expect(await testPrisma.auditLog.count()).toBe(0);
      expect(await testPrisma.user.count()).toBe(3);
      expect(await testPrisma.session.count()).toBe(0);
    });
  });

  describe('concurrent admin mutations', () => {
    let secondAdmin: TestUser;
    let secondToken: string;

    beforeEach(async () => {
      secondAdmin = await createUser(Role.ADMIN, AccountStatus.ACTIVE, {
        firstName: 'Second',
        lastName: 'Admin',
      });
      secondToken = authService.generateAccessToken({
        id: secondAdmin.id,
        role: Role.ADMIN,
      });
    });

    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function signal(): { settled: Promise<void>; resolve: () => void } {
      let resolve!: () => void;
      const settled = new Promise<void>((r) => {
        resolve = r;
      });
      return { settled, resolve };
    }

    async function holdLocks(
      acquire: (tx: Prisma.TransactionClient) => Promise<void>
    ): Promise<() => Promise<void>> {
      const held = signal();
      const released = signal();
      const txDone = testPrisma.$transaction(
        async (tx) => {
          try {
            await acquire(tx);
          } finally {
            held.resolve();
          }
          await released.settled;
        },
        { timeout: 8000 }
      );
      txDone.catch(() => undefined);
      await held.settled;

      return async () => {
        released.resolve();
        await txDone;
      };
    }

    function holdUserRows(...ids: string[]): Promise<() => Promise<void>> {
      return holdLocks(async (tx) => {
        for (const id of ids) {
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${id} FOR UPDATE`;
        }
      });
    }

    function holdSessionRows(userId: string): Promise<() => Promise<void>> {
      return holdLocks((tx) =>
        tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "userId" = ${userId} FOR UPDATE`
      );
    }

    function activeAdminCount(): Promise<number> {
      return testPrisma.user.count({
        where: { role: Role.ADMIN, status: AccountStatus.ACTIVE },
      });
    }

    it('serializes admin mutations behind the shared advisory lock', async () => {
      const release = await holdLocks((tx) => lockAdminUserMutations(tx));
      let status: number | undefined;

      const pending = patch(`/api/admin/users/${userA.id}/status`, tokenAdmin)
        .send({ status: 'SUSPENDED' })
        .then((res) => {
          status = res.status;
          return res;
        });

      try {
        await sleep(400);
        expect(status).toBeUndefined();
      } finally {
        await release();
      }

      const res = await pending;
      expect(res.status).toBe(200);
      const user = await testPrisma.user.findUnique({ where: { id: userA.id } });
      expect(user?.status).toBe(AccountStatus.SUSPENDED);
    }, 15000);

    it('never lets two concurrent demotions remove every administrator', async () => {
      const release = await holdUserRows(admin.id, secondAdmin.id);

      const demoteAdmin = patch(
        `/api/admin/users/${admin.id}/role`,
        tokenAdmin
      )
        .send({ role: 'USER' })
        .then((res) => res);
      const demoteSecond = patch(
        `/api/admin/users/${secondAdmin.id}/role`,
        secondToken
      )
        .send({ role: 'USER' })
        .then((res) => res);

      try {
        await sleep(500);
      } finally {
        await release();
      }

      const [first, second] = await Promise.all([demoteAdmin, demoteSecond]);
      expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      const rejected = first.status === 409 ? first : second;
      expect(rejected.body.error.code).toBe('LAST_ADMIN_REQUIRED');
      expect(await activeAdminCount()).toBe(1);

      const entries = await testPrisma.auditLog.findMany({
        where: { action: 'ADMIN_USER_ROLE_CHANGED' },
      });
      expect(entries).toHaveLength(1);
    }, 15000);

    it('never lets two concurrent suspensions remove every administrator', async () => {
      const release = await holdUserRows(admin.id, secondAdmin.id);

      const suspendSecond = patch(
        `/api/admin/users/${secondAdmin.id}/status`,
        tokenAdmin
      )
        .send({ status: 'SUSPENDED' })
        .then((res) => res);
      const suspendAdmin = patch(
        `/api/admin/users/${admin.id}/status`,
        secondToken
      )
        .send({ status: 'SUSPENDED' })
        .then((res) => res);

      try {
        await sleep(500);
      } finally {
        await release();
      }

      const [first, second] = await Promise.all([suspendSecond, suspendAdmin]);
      expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      const rejected = first.status === 409 ? first : second;
      expect(rejected.body.error.code).toBe('LAST_ADMIN_REQUIRED');
      expect(await activeAdminCount()).toBe(1);

      const survivors = await testPrisma.user.findMany({
        where: { role: Role.ADMIN },
        select: { status: true },
      });
      expect(survivors.filter((u) => u.status === AccountStatus.ACTIVE)).toHaveLength(1);
    }, 15000);

    it('a racing status change cannot apply DEACTIVATED to SUSPENDED', async () => {
      await createSessionFor(admin.id);
      const release = await holdSessionRows(admin.id);
      let deactivateStatus: number | undefined;

      const startSuspend = () =>
        patch(`/api/admin/users/${admin.id}/status`, secondToken)
          .send({ status: 'SUSPENDED' })
          .then((res) => res);

      const deactivate = patch(
        `/api/admin/users/${admin.id}/status`,
        secondToken
      )
        .send({ status: 'DEACTIVATED' })
        .then((res) => {
          deactivateStatus = res.status;
          return res;
        });

      let suspend: ReturnType<typeof startSuspend> | undefined;
      try {
        await sleep(400);
        expect(deactivateStatus).toBeUndefined();

        suspend = startSuspend();
        await sleep(300);
      } finally {
        await release();
      }

      const first = await deactivate;
      const second = suspend ? await suspend : undefined;
      expect(first.status).toBe(200);
      expect(second?.status).toBe(409);
      expect(second?.body.error.code).toBe('INVALID_STATUS_TRANSITION');

      const user = await testPrisma.user.findUnique({ where: { id: admin.id } });
      expect(user?.status).toBe(AccountStatus.DEACTIVATED);
    }, 15000);

    it('records the actual predecessor status in audit metadata', async () => {
      await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'SUSPENDED',
      });
      await patch(`/api/admin/users/${userA.id}/status`, tokenAdmin).send({
        status: 'ACTIVE',
      });

      const entries = await testPrisma.auditLog.findMany({
        where: { action: 'ADMIN_USER_STATUS_CHANGED' },
      });
      const transitions = entries.map((entry) => {
        const metadata = entry.metadata as { from?: string; to?: string };
        return `${metadata.from}->${metadata.to}`;
      });
      expect(transitions.sort()).toEqual(
        ['ACTIVE->SUSPENDED', 'SUSPENDED->ACTIVE'].sort()
      );
    });
  });
});
