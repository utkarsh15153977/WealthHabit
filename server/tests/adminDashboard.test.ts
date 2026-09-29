import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { AccountStatus, Role } from '@prisma/client';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import adminDashboardRoutes from '../src/routes/adminDashboardRoutes.js';

interface TestUser {
  id: string;
  email: string;
  password: string;
}

const TOP_LEVEL_KEYS = [
  'application',
  'financialRecords',
  'generatedAt',
  'users',
];

const USER_METRIC_KEYS = [
  'active',
  'admins',
  'deactivated',
  'recentlyRegistered',
  'suspended',
  'total',
];

const FINANCIAL_METRIC_KEYS = [
  'assets',
  'liabilities',
  'savingsGoals',
  'transactions',
  'wealthSnapshots',
];

const APPLICATION_METRIC_KEYS = ['challenges', 'habits', 'notifications'];

const ALLOWED_KEYS = new Set([
  'success',
  'data',
  ...TOP_LEVEL_KEYS,
  ...USER_METRIC_KEYS,
  ...FINANCIAL_METRIC_KEYS,
  ...APPLICATION_METRIC_KEYS,
]);

function collectKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, found));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      found.add(key);
      collectKeys(entry, found);
    }
  }
  return found;
}

function collectNumbers(value: unknown, found: number[] = []): number[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNumbers(entry, found));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectNumbers(entry, found));
  } else if (typeof value === 'number') {
    found.push(value);
  }
  return found;
}

describe('Admin dashboard API', () => {
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

  async function seedFinancialRecords(): Promise<void> {
    const category = await testPrisma.category.create({
      data: { userId: user.id, name: 'General', type: 'EXPENSE' },
    });
    await testPrisma.transaction.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        type: 'EXPENSE',
        amount: 1234.56,
        transactionDate: new Date(),
      },
    });
    await testPrisma.transaction.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        type: 'INCOME',
        amount: 4321.99,
        transactionDate: new Date(),
      },
    });
    await testPrisma.savingsGoal.create({
      data: {
        userId: user.id,
        name: 'Emergency fund',
        targetAmount: 5000,
        currentAmount: 2500.75,
        targetDate: new Date('2027-01-01'),
        category: 'general',
      },
    });
    await testPrisma.asset.create({
      data: {
        userId: user.id,
        name: 'Checking',
        type: 'CASH',
        currentValue: 8765.43,
      },
    });
    await testPrisma.liability.create({
      data: {
        userId: user.id,
        name: 'Card',
        type: 'CREDIT_CARD',
        outstandingAmount: 987.65,
      },
    });
    await testPrisma.wealthSnapshot.create({
      data: {
        userId: user.id,
        snapshotDate: new Date('2026-01-01'),
        totalAssets: 10000.25,
        totalLiabilities: 2500.5,
        netWorth: 7499.75,
      },
    });
    await testPrisma.financialHabit.create({
      data: {
        userId: user.id,
        name: 'Track daily expenses',
        frequency: 'DAILY',
        startDate: new Date(),
        target: 50,
      },
    });
    await testPrisma.challenge.create({
      data: {
        name: 'No-spend week',
        description: 'Avoid discretionary spending',
        category: 'Savings',
        difficulty: 'MEDIUM',
        points: 100,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });
    await testPrisma.notification.create({
      data: {
        userId: user.id,
        type: 'HABIT_REMINDER',
        title: 'Habit reminder',
        message: 'Track today\'s expenses',
      },
    });
  }

  async function snapshotCounts(): Promise<Record<string, number>> {
    return {
      users: await testPrisma.user.count(),
      categories: await testPrisma.category.count(),
      transactions: await testPrisma.transaction.count(),
      savingsGoals: await testPrisma.savingsGoal.count(),
      assets: await testPrisma.asset.count(),
      liabilities: await testPrisma.liability.count(),
      wealthSnapshots: await testPrisma.wealthSnapshot.count(),
      habits: await testPrisma.financialHabit.count(),
      challenges: await testPrisma.challenge.count(),
      notifications: await testPrisma.notification.count(),
      sessions: await testPrisma.session.count(),
      auditLogs: await testPrisma.auditLog.count(),
    };
  }

  beforeEach(async () => {
    await testPrisma.auditLog.deleteMany();

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
    app.use('/api/admin', adminDashboardRoutes);
    app.use(errorHandler);
  });

  function get(url: string, token?: string) {
    const req = request(app).get(url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  describe('authentication', () => {
    it('rejects anonymous requests with 401', async () => {
      const res = await get('/api/admin/dashboard');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('does not leak a 403 distinction before authentication', async () => {
      const res = await get('/api/admin/dashboard');
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHORIZED');
    });
  });

  describe('authorization', () => {
    it('rejects a normal USER with 403', async () => {
      const res = await get('/api/admin/dashboard', tokenUser);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('allows an ADMIN with 200', async () => {
      const res = await get('/api/admin/dashboard', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('rejects a suspended admin with 403 ACCOUNT_SUSPENDED', async () => {
      await testPrisma.user.update({
        where: { id: admin.id },
        data: { status: AccountStatus.SUSPENDED },
      });
      const res = await get('/api/admin/dashboard', tokenAdmin);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('rejects a deactivated admin with 403', async () => {
      await testPrisma.user.update({
        where: { id: admin.id },
        data: { status: AccountStatus.DEACTIVATED },
      });
      const res = await get('/api/admin/dashboard', tokenAdmin);
      expect(res.status).toBe(403);
    });

    it('rejects a malformed bearer token with 401', async () => {
      const res = await get('/api/admin/dashboard', 'not-a-real-token');
      expect(res.status).toBe(401);
    });
  });

  describe('spoofing resistance', () => {
    it('ignores an X-User-Role: ADMIN header', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${tokenUser}`)
        .set('X-User-Role', 'ADMIN');
      expect(res.status).toBe(403);
    });

    it('ignores an X-User-Id header of an admin', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${tokenUser}`)
        .set('X-User-Id', admin.id);
      expect(res.status).toBe(403);
    });

    it('ignores a ?role=ADMIN query parameter', async () => {
      const res = await get('/api/admin/dashboard?role=ADMIN', tokenUser);
      expect(res.status).toBe(403);
    });

    it('ignores a role field in the request body', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${tokenUser}`)
        .send({ role: 'ADMIN' });
      expect(res.status).toBe(403);
    });

    it('ignores a role field and headers together', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard?role=ADMIN&admin=true')
        .set('Authorization', `Bearer ${tokenUser}`)
        .set('X-User-Role', 'ADMIN')
        .set('X-User-Id', admin.id)
        .send({ role: 'ADMIN', isAdmin: true });
      expect(res.status).toBe(403);
      expect(res.body.data).toBeUndefined();
    });
  });

  describe('response contract', () => {
    it('returns success and the allowlisted data sections', async () => {
      const res = await get('/api/admin/dashboard', tokenAdmin);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Object.keys(res.body.data).sort()).toEqual(TOP_LEVEL_KEYS);
    });

    it('returns the exact user metric keys', async () => {
      const res = await get('/api/admin/dashboard', tokenAdmin);
      expect(Object.keys(res.body.data.users).sort()).toEqual(
        USER_METRIC_KEYS
      );
    });

    it('returns the exact financial record metric keys', async () => {
      const res = await get('/api/admin/dashboard', tokenAdmin);
      expect(Object.keys(res.body.data.financialRecords).sort()).toEqual(
        FINANCIAL_METRIC_KEYS
      );
    });

    it('returns the exact application metric keys', async () => {
      const res = await get('/api/admin/dashboard', tokenAdmin);
      expect(Object.keys(res.body.data.application).sort()).toEqual(
        APPLICATION_METRIC_KEYS
      );
    });

    it('returns only non-negative integer counts', async () => {
      const res = await get('/api/admin/dashboard', tokenAdmin);
      const numbers = [
        ...Object.values(res.body.data.users),
        ...Object.values(res.body.data.financialRecords),
        ...Object.values(res.body.data.application),
      ];
      expect(numbers).toHaveLength(
        USER_METRIC_KEYS.length +
          FINANCIAL_METRIC_KEYS.length +
          APPLICATION_METRIC_KEYS.length
      );
      for (const value of numbers) {
        expect(typeof value).toBe('number');
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });

    it('returns an ISO-8601 generatedAt timestamp', async () => {
      const res = await get('/api/admin/dashboard', tokenAdmin);
      const generatedAt = res.body.data.generatedAt;
      expect(typeof generatedAt).toBe('string');
      expect(Number.isNaN(Date.parse(generatedAt))).toBe(false);
      expect(new Date(generatedAt).toISOString()).toBe(generatedAt);
    });

    it('regenerates the timestamp on each request instead of caching', async () => {
      const first = await get('/api/admin/dashboard', tokenAdmin);
      const second = await get('/api/admin/dashboard', tokenAdmin);
      expect(typeof first.body.data.generatedAt).toBe('string');
      expect(typeof second.body.data.generatedAt).toBe('string');
      expect(
        second.body.data.generatedAt >= first.body.data.generatedAt
      ).toBe(true);
    });
  });

  describe('metrics', () => {
    it('counts users by status and role', async () => {
      await createUser(Role.USER, AccountStatus.SUSPENDED);
      await createUser(Role.USER, AccountStatus.DEACTIVATED);

      const res = await get('/api/admin/dashboard', tokenAdmin);
      expect(res.body.data.users).toEqual({
        total: 4,
        active: 2,
        suspended: 1,
        deactivated: 1,
        admins: 1,
        recentlyRegistered: 4,
      });
    });

    it('counts seeded financial records and application records', async () => {
      await seedFinancialRecords();

      const res = await get('/api/admin/dashboard', tokenAdmin);
      expect(res.body.data.financialRecords).toEqual({
        transactions: 2,
        savingsGoals: 1,
        assets: 1,
        liabilities: 1,
        wealthSnapshots: 1,
      });
      expect(res.body.data.application).toEqual({
        habits: 1,
        challenges: 1,
        notifications: 1,
      });
    });

    it('agrees with the database counts it reports', async () => {
      await seedFinancialRecords();
      const res = await get('/api/admin/dashboard', tokenAdmin);

      expect(res.body.data.users.total).toBe(await testPrisma.user.count());
      expect(res.body.data.financialRecords.transactions).toBe(
        await testPrisma.transaction.count()
      );
      expect(res.body.data.financialRecords.savingsGoals).toBe(
        await testPrisma.savingsGoal.count()
      );
      expect(res.body.data.financialRecords.assets).toBe(
        await testPrisma.asset.count()
      );
      expect(res.body.data.financialRecords.liabilities).toBe(
        await testPrisma.liability.count()
      );
      expect(res.body.data.financialRecords.wealthSnapshots).toBe(
        await testPrisma.wealthSnapshot.count()
      );
      expect(res.body.data.application.habits).toBe(
        await testPrisma.financialHabit.count()
      );
      expect(res.body.data.application.challenges).toBe(
        await testPrisma.challenge.count()
      );
      expect(res.body.data.application.notifications).toBe(
        await testPrisma.notification.count()
      );
    });
  });

  describe('data safety', () => {
    it('exposes only allowlisted keys', async () => {
      await seedFinancialRecords();
      const res = await get('/api/admin/dashboard', tokenAdmin);
      const keys = collectKeys(res.body);
      const unexpected = [...keys].filter((key) => !ALLOWED_KEYS.has(key));
      expect(unexpected).toEqual([]);
    });

    it('does not expose any financial amounts', async () => {
      await seedFinancialRecords();
      const res = await get('/api/admin/dashboard', tokenAdmin);
      const json = JSON.stringify(res.body);

      for (const amount of [
        '1234.56',
        '4321.99',
        '5000',
        '2500.75',
        '8765.43',
        '987.65',
        '10000.25',
        '7499.75',
        '2500.5',
      ]) {
        expect(json).not.toContain(amount);
      }

      for (const value of collectNumbers(res.body)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThan(1000000);
      }
    });

    it('never returns credentials or personal details', async () => {
      const res = await get('/api/admin/dashboard', tokenAdmin);
      const json = JSON.stringify(res.body);
      expect(json).not.toContain('passwordHash');
      expect(json).not.toContain('refreshTokenHash');
      expect(json).not.toContain('password');
      expect(json).not.toContain(user.email);
      expect(json).not.toContain(admin.email);
      expect(json).not.toContain(user.id);
      expect(json).not.toContain(admin.id);
    });
  });

  describe('read-only behaviour', () => {
    it('performs no writes on GET requests', async () => {
      await seedFinancialRecords();

      const before = await snapshotCounts();
      await get('/api/admin/dashboard', tokenAdmin);
      await get('/api/admin/dashboard', tokenAdmin);
      const after = await snapshotCounts();

      expect(after).toEqual(before);
    });

    it('generates no audit event when the dashboard is read', async () => {
      await get('/api/admin/dashboard', tokenAdmin);
      await get('/api/admin/dashboard', tokenAdmin);
      expect(await testPrisma.auditLog.count()).toBe(0);
    });

    it('generates no audit event for rejected requests either', async () => {
      await get('/api/admin/dashboard');
      await get('/api/admin/dashboard', tokenUser);
      expect(await testPrisma.auditLog.count()).toBe(0);
    });

    it('does not touch stored record values', async () => {
      await seedFinancialRecords();
      const before = await testPrisma.savingsGoal.findFirstOrThrow();
      const assetBefore = await testPrisma.asset.findFirstOrThrow();

      await get('/api/admin/dashboard', tokenAdmin);

      const after = await testPrisma.savingsGoal.findFirstOrThrow();
      const assetAfter = await testPrisma.asset.findFirstOrThrow();
      expect(after.targetAmount).toEqual(before.targetAmount);
      expect(after.currentAmount).toEqual(before.currentAmount);
      expect(assetAfter.currentValue).toEqual(assetBefore.currentValue);
    });
  });

  describe('method safety', () => {
    const mutations: ['post', 'patch', 'put', 'delete'] = [
      'post',
      'patch',
      'put',
      'delete',
    ];

    for (const method of mutations) {
      it(`rejects ${method.toUpperCase()} /api/admin/dashboard with 404`, async () => {
        const res = await request(app)
          [method]('/api/admin/dashboard')
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({});
        expect(res.status).toBe(404);
        expect(res.body.data).toBeUndefined();
      });
    }

    it('leaves no audit event after rejected mutations', async () => {
      await request(app)
        .post('/api/admin/dashboard')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({});
      expect(await testPrisma.auditLog.count()).toBe(0);
    });
  });
});
