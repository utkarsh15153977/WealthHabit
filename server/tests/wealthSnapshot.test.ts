import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, CategoryType, TransactionType, Prisma } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  assetRouter,
  liabilityRouter,
  summaryRouter,
} from '../src/routes/assetLiabilityRoutes.js';
import { wealthSnapshotRouter } from '../src/routes/wealthSnapshotRoutes.js';
import goalRoutes from '../src/routes/goalRoutes.js';
import { addUtcDays, startOfUtcDay } from '../src/utils/date.js';
import { prisma } from '../src/config/prisma.js';
import { createTodayWealthSnapshot } from '../src/services/prismaWealthSnapshotService.js';

describe('Net Worth & Wealth Snapshots API', () => {
  let app: express.Express;
  let userA: { id: string };
  let userB: { id: string };
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    const a = createTestUser();
    const b = createTestUser();
    const hashA = await hashPassword(a.password);
    const hashB = await hashPassword(b.password);

    const createdA = await testPrisma.user.create({
      data: {
        email: a.email,
        passwordHash: hashA,
        firstName: a.firstName,
        lastName: a.lastName,
        role: Role.USER,
        status: AccountStatus.ACTIVE,
      },
    });
    const createdB = await testPrisma.user.create({
      data: {
        email: b.email,
        passwordHash: hashB,
        firstName: b.firstName,
        lastName: b.lastName,
        role: Role.USER,
        status: AccountStatus.ACTIVE,
      },
    });

    userA = { id: createdA.id };
    userB = { id: createdB.id };
    tokenA = authService.generateAccessToken({
      id: createdA.id,
      role: createdA.role,
    });
    tokenB = authService.generateAccessToken({
      id: createdB.id,
      role: createdB.role,
    });

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/assets', assetRouter);
    app.use('/api/liabilities', liabilityRouter);
    app.use('/api/assets-liabilities', summaryRouter);
    app.use('/api/wealth-snapshots', wealthSnapshotRouter);
    app.use('/api/goals', goalRoutes);
    app.use(errorHandler);
  });

  function post(url: string, token: string = tokenA) {
    return request(app).post(url).set('Authorization', `Bearer ${token}`);
  }

  function get(url: string, token: string = tokenA) {
    return request(app).get(url).set('Authorization', `Bearer ${token}`);
  }

  async function createAsset(
    currentValue: string,
    token: string = tokenA
  ): Promise<void> {
    const res = await post('/api/assets', token).send({
      name: 'Bank account',
      currentValue,
    });
    expect(res.status).toBe(201);
  }

  async function createLiability(
    outstandingAmount: string,
    token: string = tokenA
  ): Promise<void> {
    const res = await post('/api/liabilities', token).send({
      name: 'Credit card',
      outstandingAmount,
    });
    expect(res.status).toBe(201);
  }

  function insertSnapshot(
    userId: string,
    dayOffset: number,
    totalAssets: string,
    totalLiabilities: string,
    netWorth: string
  ) {
    return testPrisma.wealthSnapshot.create({
      data: {
        userId,
        snapshotDate: addUtcDays(new Date(), dayOffset),
        totalAssets,
        totalLiabilities,
        netWorth,
      },
    });
  }

  describe('authentication', () => {
    it('requires a token on every snapshot endpoint', async () => {
      const snapshot = await insertSnapshot(userA.id, 0, '100', '40', '60');

      expect((await request(app).get('/api/wealth-snapshots')).status).toBe(401);
      expect((await request(app).post('/api/wealth-snapshots')).status).toBe(401);
      expect(
        (await request(app).get(`/api/wealth-snapshots/${snapshot.id}`)).status
      ).toBe(401);
    });
  });

  describe('current net worth', () => {
    it('returns zeroed figures for a user with no records', async () => {
      const res = await get('/api/assets-liabilities/summary');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
        assetCount: 0,
        liabilityCount: 0,
      });
    });

    it('computes net worth as total assets minus total liabilities', async () => {
      await createAsset('5000.00');
      await createAsset('1500.00');
      await createLiability('2000.00');

      const res = await get('/api/assets-liabilities/summary');

      expect(res.body.data.totalAssets).toBe(6500);
      expect(res.body.data.totalLiabilities).toBe(2000);
      expect(res.body.data.netWorth).toBe(4500);
    });

    it('keeps a negative net worth instead of clamping it to zero', async () => {
      await createAsset('1000.00');
      await createLiability('2500.00');

      const res = await get('/api/assets-liabilities/summary');

      expect(res.body.data.netWorth).toBe(-1500);
    });

    it('stays negative when there are no assets at all', async () => {
      await createLiability('75000.00');

      const res = await get('/api/assets-liabilities/summary');

      expect(res.body.data.totalAssets).toBe(0);
      expect(res.body.data.netWorth).toBe(-75000);
    });

    it('subtracts in decimal arithmetic without floating point drift', async () => {
      await createAsset('0.10');
      await createAsset('0.20');
      await createAsset('33.33');
      await createLiability('0.10');
      await createLiability('0.20');

      const res = await get('/api/assets-liabilities/summary');

      expect(res.body.data.totalAssets).toBe(33.63);
      expect(res.body.data.totalLiabilities).toBe(0.3);
      expect(res.body.data.netWorth).toBe(33.33);
    });

    it('keeps net worth isolated per user', async () => {
      await createAsset('1000.00');
      await createLiability('400.00');
      await createAsset('9999.00', tokenB);
      await createLiability('999.00', tokenB);

      const mine = await get('/api/assets-liabilities/summary');
      const theirs = await get('/api/assets-liabilities/summary', tokenB);

      expect(mine.body.data.netWorth).toBe(600);
      expect(theirs.body.data.netWorth).toBe(9000);
    });

    it('is always derived from live records, never from a stored snapshot', async () => {
      await createAsset('100000.00');
      await createLiability('40000.00');

      const captured = await post('/api/wealth-snapshots').send({});
      expect(captured.status).toBe(201);
      expect(captured.body.data.snapshot.netWorth).toBe(60000);

      await post('/api/assets').send({ name: 'Bonds', currentValue: '50000.00' });

      const res = await get('/api/assets-liabilities/summary');

      expect(res.body.data.totalAssets).toBe(150000);
      expect(res.body.data.netWorth).toBe(110000);
    });

    it('never counts transactions or goal contributions', async () => {
      const category = await testPrisma.category.create({
        data: {
          userId: userA.id,
          name: 'Groceries',
          type: CategoryType.EXPENSE,
          isDefault: false,
        },
      });
      await testPrisma.transaction.create({
        data: {
          userId: userA.id,
          categoryId: category.id,
          type: TransactionType.EXPENSE,
          amount: '999999.00',
          transactionDate: new Date(),
          description: 'Weekly groceries',
        },
      });

      const goal = await post('/api/goals').send({
        name: 'Emergency fund',
        targetAmount: '200000.00',
        targetDate: '2027-01-01',
      });
      expect(goal.status).toBe(201);
      const contribution = await post(
        `/api/goals/${goal.body.data.goal.id}/contributions`
      ).send({ amount: '20000.00' });
      expect(contribution.status).toBe(201);

      const res = await get('/api/assets-liabilities/summary');

      expect(res.body.data).toEqual({
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
        assetCount: 0,
        liabilityCount: 0,
      });
      expect(await testPrisma.transaction.count()).toBe(1);
      expect(await testPrisma.goalContribution.count()).toBe(1);
    });
  });

  describe('create snapshot', () => {
    it('captures today as a UTC day with derived figures only', async () => {
      await createAsset('120000.00');
      await createLiability('45000.00');

      const res = await post('/api/wealth-snapshots').send({});

      expect(res.status).toBe(201);
      expect(res.body.data.created).toBe(true);

      const snapshot = res.body.data.snapshot;
      expect(Object.keys(snapshot).sort()).toEqual([
        'id',
        'netWorth',
        'snapshotDate',
        'totalAssets',
        'totalLiabilities',
      ]);
      expect(snapshot.snapshotDate).toBe(
        startOfUtcDay(new Date()).toISOString()
      );
      expect(snapshot.totalAssets).toBe(120000);
      expect(snapshot.totalLiabilities).toBe(45000);
      expect(snapshot.netWorth).toBe(75000);
      expect(snapshot.userId).toBeUndefined();

      const stored = await testPrisma.wealthSnapshot.findUnique({
        where: { id: snapshot.id },
      });
      expect(stored).not.toBeNull();
      expect(stored?.userId).toBe(userA.id);
      expect(stored?.netWorth.toNumber()).toBe(75000);
    });

    it('captures a snapshot with no body at all', async () => {
      const res = await post('/api/wealth-snapshots');

      expect(res.status).toBe(201);
      expect(res.body.data.snapshot.netWorth).toBe(0);
    });

    it('stores a negative net worth as captured', async () => {
      await createLiability('30000.00');

      const res = await post('/api/wealth-snapshots').send({});

      expect(res.status).toBe(201);
      expect(res.body.data.snapshot.netWorth).toBe(-30000);
      expect(
        (await testPrisma.wealthSnapshot.findFirst({ where: { userId: userA.id } }))
          ?.netWorth.toNumber()
      ).toBe(-30000);
    });

    it('is idempotent within the same UTC day', async () => {
      await createAsset('5000.00');

      const first = await post('/api/wealth-snapshots').send({});
      const second = await post('/api/wealth-snapshots').send({});

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.data.created).toBe(false);
      expect(second.body.data.snapshot.id).toBe(first.body.data.snapshot.id);
      expect(await testPrisma.wealthSnapshot.count()).toBe(1);
    });

    it('handles concurrent captures with a single row and no 500', async () => {
      await createAsset('8000.00');

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => post('/api/wealth-snapshots').send({}))
      );

      for (const res of responses) {
        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
      }
      expect(
        responses.filter((res) => res.status === 201)
      ).toHaveLength(1);
      expect(await testPrisma.wealthSnapshot.count()).toBe(1);
    });

    it('captures an immutable point in time when records change later', async () => {
      await createAsset('100000.00');
      await createLiability('40000.00');

      const res = await post('/api/wealth-snapshots').send({});
      const snapshotId = res.body.data.snapshot.id as string;

      const assetId = (
        await get('/api/assets')
      ).body.data.assets[0].id as string;
      const patched = await request(app)
        .patch(`/api/assets/${assetId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ currentValue: '200000.00' });
      expect(patched.status).toBe(200);

      const stored = await testPrisma.wealthSnapshot.findUnique({
        where: { id: snapshotId },
      });
      expect(stored?.totalAssets.toNumber()).toBe(100000);
      expect(stored?.totalLiabilities.toNumber()).toBe(40000);
      expect(stored?.netWorth.toNumber()).toBe(60000);

      const summary = await get('/api/assets-liabilities/summary');
      expect(summary.body.data.netWorth).toBe(160000);
    });

    it('rejects any client supplied snapshot field', async () => {
      await createAsset('1000.00');

      const res = await post('/api/wealth-snapshots').send({
        userId: userB.id,
        snapshotDate: '2020-01-01T00:00:00.000Z',
        totalAssets: '999999.00',
        totalLiabilities: 0,
        netWorth: 999999,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await testPrisma.wealthSnapshot.count()).toBe(0);
    });

    it('captures one snapshot per user per day', async () => {
      const mine = await post('/api/wealth-snapshots').send({});
      const theirs = await post('/api/wealth-snapshots', tokenB).send({});

      expect(mine.status).toBe(201);
      expect(theirs.status).toBe(201);
      expect(mine.body.data.snapshot.id).not.toBe(theirs.body.data.snapshot.id);
      expect(await testPrisma.wealthSnapshot.count()).toBe(2);
    });

    it('keeps a snapshot when its source records are deleted', async () => {
      await createAsset('60000.00');
      await createLiability('60000.00');
      const res = await post('/api/wealth-snapshots').send({});

      const assets = (await get('/api/assets')).body.data.assets;
      const liabilities = (await get('/api/liabilities')).body.data.liabilities;
      expect(
        (
          await request(app)
            .delete(`/api/assets/${assets[0].id}`)
            .set('Authorization', `Bearer ${tokenA}`)
        ).status
      ).toBe(200);
      expect(
        (
          await request(app)
            .delete(`/api/liabilities/${liabilities[0].id}`)
            .set('Authorization', `Bearer ${tokenA}`)
        ).status
      ).toBe(200);

      const stored = await testPrisma.wealthSnapshot.findUnique({
        where: { id: res.body.data.snapshot.id },
      });
      expect(stored?.netWorth.toNumber()).toBe(0);

      const summary = await get('/api/assets-liabilities/summary');
      expect(summary.body.data.netWorth).toBe(0);
      expect(await testPrisma.wealthSnapshot.count()).toBe(1);
    });

    it('does not create transactions, goals, notifications or budgets', async () => {
      await createAsset('10000.00');
      await createLiability('4000.00');
      await post('/api/wealth-snapshots').send({});

      const [transactions, goals, notifications, budgets] = await Promise.all([
        testPrisma.transaction.count(),
        testPrisma.savingsGoal.count(),
        testPrisma.notification.count(),
        testPrisma.budget.count(),
      ]);

      expect(transactions).toBe(0);
      expect(goals).toBe(0);
      expect(notifications).toBe(0);
      expect(budgets).toBe(0);
    });
  });

  describe('transaction isolation', () => {
    it('captures inside a single RepeatableRead transaction', async () => {
      await createAsset('120000.00');
      await createLiability('45000.00');

      const transactionSpy = vi.spyOn(prisma, '$transaction');

      try {
        const result = await createTodayWealthSnapshot(userA.id);

        expect(transactionSpy).toHaveBeenCalledTimes(1);
        expect(transactionSpy).toHaveBeenCalledWith(expect.any(Function), {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        });

        expect(result.created).toBe(true);
        expect(result.snapshot.totalAssets.toNumber()).toBe(120000);
        expect(result.snapshot.totalLiabilities.toNumber()).toBe(45000);
        expect(result.snapshot.netWorth.toNumber()).toBe(75000);
        expect(result.snapshot.userId).toBe(userA.id);
      } finally {
        transactionSpy.mockRestore();
      }
    });
  });

  describe('list snapshots', () => {
    it('returns an empty page for a user with no snapshots', async () => {
      const res = await get('/api/wealth-snapshots');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        snapshots: [],
        page: 1,
        pageSize: 20,
        total: 0,
      });
    });

    it('lists only the caller snapshots, newest day first', async () => {
      await insertSnapshot(userA.id, -2, '100', '100', '0');
      await insertSnapshot(userA.id, -1, '300', '100', '200');
      await insertSnapshot(userA.id, -3, '50', '80', '-30');
      await insertSnapshot(userB.id, -1, '9000', '1000', '8000');

      const res = await get('/api/wealth-snapshots');

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(3);
      expect(
        res.body.data.snapshots.map(
          (snapshot: { netWorth: number }) => snapshot.netWorth
        )
      ).toEqual([200, 0, -30]);
      expect(res.body.data.snapshots[0].snapshotDate).toBe(
        addUtcDays(new Date(), -1).toISOString()
      );
      expect(
        res.body.data.snapshots.every(
          (snapshot: { netWorth: number }) => snapshot.netWorth !== 8000
        )
      ).toBe(true);
    });

    it('paginates with page and pageSize', async () => {
      await insertSnapshot(userA.id, -1, '100', '40', '60');
      await insertSnapshot(userA.id, -2, '200', '40', '160');
      await insertSnapshot(userA.id, -3, '300', '40', '260');

      const firstPage = await get('/api/wealth-snapshots?page=1&pageSize=2');
      const secondPage = await get('/api/wealth-snapshots?page=2&pageSize=2');

      expect(firstPage.body.data.total).toBe(3);
      expect(firstPage.body.data.page).toBe(1);
      expect(firstPage.body.data.pageSize).toBe(2);
      expect(firstPage.body.data.snapshots).toHaveLength(2);
      expect(firstPage.body.data.snapshots[0].netWorth).toBe(60);
      expect(firstPage.body.data.snapshots[1].netWorth).toBe(160);
      expect(secondPage.body.data.snapshots).toHaveLength(1);
      expect(secondPage.body.data.snapshots[0].netWorth).toBe(260);
    });

    it('caps pageSize at 50 and rejects invalid paging', async () => {
      const tooLarge = await get('/api/wealth-snapshots?pageSize=51');
      const zeroPage = await get('/api/wealth-snapshots?page=0');
      const unknownParam = await get('/api/wealth-snapshots?foo=1');

      expect(tooLarge.status).toBe(400);
      expect(zeroPage.status).toBe(400);
      expect(unknownParam.status).toBe(400);
    });
  });

  describe('get one snapshot', () => {
    it('returns the caller snapshot', async () => {
      await createAsset('4000.00');
      await createLiability('1000.00');
      const created = await post('/api/wealth-snapshots').send({});

      const res = await get(
        `/api/wealth-snapshots/${created.body.data.snapshot.id}`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.snapshot.netWorth).toBe(3000);
      expect(res.body.data.snapshot.id).toBe(created.body.data.snapshot.id);
    });

    it('returns 404 for another user snapshot', async () => {
      const theirs = await insertSnapshot(userB.id, -1, '500', '100', '400');

      const res = await get(`/api/wealth-snapshots/${theirs.id}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('WEALTH_SNAPSHOT_NOT_FOUND');
      expect(await testPrisma.wealthSnapshot.count()).toBe(1);
    });

    it('returns 404 for an unknown id', async () => {
      const res = await get('/api/wealth-snapshots/does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('WEALTH_SNAPSHOT_NOT_FOUND');
    });
  });

  describe('immutability', () => {
    it('exposes no update or delete route', async () => {
      const created = await post('/api/wealth-snapshots').send({});
      const id = created.body.data.snapshot.id as string;

      const patched = await request(app)
        .patch(`/api/wealth-snapshots/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ netWorth: 999999 });
      const deleted = await request(app)
        .delete(`/api/wealth-snapshots/${id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(patched.status).toBe(404);
      expect(deleted.status).toBe(404);

      const stored = await testPrisma.wealthSnapshot.findUnique({
        where: { id },
      });
      expect(stored?.netWorth.toNumber()).toBe(0);
      expect(await testPrisma.wealthSnapshot.count()).toBe(1);
    });
  });

  describe('clean state', () => {
    it('starts each test with no snapshots', async () => {
      expect(await testPrisma.wealthSnapshot.count()).toBe(0);
      expect(userA.id).not.toBe(userB.id);
    });
  });
});
