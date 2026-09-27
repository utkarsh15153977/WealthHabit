import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, TransactionType } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  assetRouter,
  liabilityRouter,
  summaryRouter,
} from '../src/routes/assetLiabilityRoutes.js';
import { wealthSnapshotRouter } from '../src/routes/wealthSnapshotRoutes.js';
import { wealthAnalyticsRouter } from '../src/routes/wealthAnalyticsRoutes.js';
import goalRoutes from '../src/routes/goalRoutes.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';
import { addUtcDays, startOfUtcDay } from '../src/utils/date.js';

describe('Wealth Analytics API', () => {
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
    app.use('/api/wealth-analytics', wealthAnalyticsRouter);
    app.use('/api/goals', goalRoutes);
    app.use('/api/categories', categoryRoutes);
    app.use('/api/transactions', transactionRoutes);
    app.use(errorHandler);
  });

  function get(url: string, token: string = tokenA) {
    return request(app).get(url).set('Authorization', `Bearer ${token}`);
  }

  function post(url: string, body: unknown, token: string = tokenA) {
    return request(app)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);
  }

  async function createAsset(
    name: string,
    value: string,
    type?: string,
    token: string = tokenA
  ): Promise<string> {
    const result = await post('/api/assets', { name, type, currentValue: value }, token);
    expect(result.status).toBe(201);
    return result.body.data.asset.id as string;
  }

  async function createLiability(
    name: string,
    value: string,
    type?: string,
    token: string = tokenA
  ): Promise<string> {
    const result = await post(
      '/api/liabilities',
      { name, type, outstandingAmount: value },
      token
    );
    expect(result.status).toBe(201);
    return result.body.data.liability.id as string;
  }

  async function createGoal(
    name: string,
    targetAmount: string,
    token: string = tokenA
  ): Promise<string> {
    const result = await post(
      '/api/goals',
      { name, targetAmount, targetDate: '2027-06-30' },
      token
    );
    expect(result.status).toBe(201);
    return result.body.data.goal.id as string;
  }

  async function contribute(
    goalId: string,
    amount: string,
    token: string = tokenA
  ): Promise<void> {
    const result = await post(`/api/goals/${goalId}/contributions`, { amount }, token);
    expect(result.status).toBe(201);
  }

  async function createCategory(
    name: string,
    type: 'INCOME' | 'EXPENSE',
    token: string = tokenA
  ): Promise<string> {
    const result = await post('/api/categories', { name, type }, token);
    expect(result.status).toBe(201);
    return result.body.data.category.id as string;
  }

  async function createTransaction(
    categoryId: string,
    type: 'INCOME' | 'EXPENSE',
    amount: string,
    daysAgo: number,
    token: string = tokenA
  ): Promise<string> {
    const transactionDate = startOfUtcDay(addUtcDays(new Date(), -daysAgo))
      .toISOString()
      .slice(0, 10);
    const result = await post(
      '/api/transactions',
      { categoryId, type, amount, transactionDate },
      token
    );
    expect(result.status).toBe(201);
    return result.body.data.transaction.id as string;
  }

  async function insertSnapshot(
    userId: string,
    daysAgo: number,
    totalAssets: number,
    totalLiabilities: number,
    netWorth: number
  ): Promise<void> {
    await testPrisma.wealthSnapshot.create({
      data: {
        userId,
        snapshotDate: startOfUtcDay(addUtcDays(new Date(), -daysAgo)),
        totalAssets,
        totalLiabilities,
        netWorth,
      },
    });
  }

  async function summary(token: string = tokenA) {
    const result = await get('/api/wealth-analytics/summary', token);
    expect(result.status).toBe(200);
    return result.body.data;
  }

  describe('current financial position', () => {
    it('derives the current position from live assets only', async () => {
      await createAsset('Cash wallet', '5000.50', 'CASH');
      await createAsset('Savings account', '2500.25', 'BANK_ACCOUNT');

      const data = await summary();

      expect(data.current).toEqual({
        totalAssets: 7500.75,
        totalLiabilities: 0,
        netWorth: 7500.75,
        assetCount: 2,
        liabilityCount: 0,
      });
    });

    it('returns a negative net worth when liabilities exceed assets', async () => {
      await createAsset('Old phone', '1000.00');
      await createLiability('Credit card', '2500.00', 'CREDIT_CARD');

      const data = await summary();

      expect(data.current.netWorth).toBe(-1500);
      expect(data.current.totalLiabilities).toBe(2500);
    });

    it('reports a zero net worth when assets equal liabilities', async () => {
      await createAsset('Savings account', '1000.00');
      await createLiability('Personal loan', '1000.00', 'PERSONAL_LOAN');

      const data = await summary();

      expect(data.current.netWorth).toBe(0);
    });

    it('never includes transactions or goal contributions in net worth', async () => {
      const incomeCategory = await createCategory('Salary', 'INCOME');
      await createTransaction(incomeCategory, 'INCOME', '500000.00', 2);
      const goalId = await createGoal('Emergency fund', '200000.00');
      await contribute(goalId, '50000.00');
      await createAsset('Savings account', '5000.00');

      const data = await summary();

      expect(data.current.netWorth).toBe(5000);
      expect(data.current.totalAssets).toBe(5000);
      expect(data.goals.totalSavedAmount).toBe(50000);
    });

    it('matches the Phase 5C live net worth summary exactly', async () => {
      await createAsset('Savings account', '155000.50');
      await createLiability('Credit card', '35000.25');

      const analytics = await summary();
      const phase5c = await get('/api/assets-liabilities/summary');

      expect(phase5c.status).toBe(200);
      expect(analytics.current.totalAssets).toBe(phase5c.body.data.totalAssets);
      expect(analytics.current.totalLiabilities).toBe(
        phase5c.body.data.totalLiabilities
      );
      expect(analytics.current.netWorth).toBe(phase5c.body.data.netWorth);
      expect(analytics.current.assetCount).toBe(phase5c.body.data.assetCount);
      expect(analytics.current.liabilityCount).toBe(
        phase5c.body.data.liabilityCount
      );
    });

    it('keeps Decimal precision at two places', async () => {
      await createAsset('Savings account', '155000.50');
      await createLiability('Credit card', '35000.25');

      const data = await summary();

      expect(data.current.netWorth).toBe(120000.25);
    });

    it('isolates the current position per user', async () => {
      await createAsset('Savings account', '155000.50');
      await createLiability('Credit card', '35000.00');

      const other = await summary(tokenB);

      expect(other.current).toEqual({
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
        assetCount: 0,
        liabilityCount: 0,
      });
    });

    it('rejects unknown query parameters', async () => {
      const result = await get('/api/wealth-analytics/summary?totalAssets=999999');

      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects anonymous requests', async () => {
      const result = await request(app).get('/api/wealth-analytics/summary');

      expect(result.status).toBe(401);
    });
  });

  describe('net worth history', () => {
    it('returns an empty history when no snapshots exist', async () => {
      const result = await get('/api/wealth-analytics/net-worth');

      expect(result.status).toBe(200);
      expect(result.body.data.history).toEqual([]);
      expect(result.body.data.change).toEqual({ absolute: null, percentage: null });
    });

    it('returns stored snapshots in chronological order with stored values', async () => {
      await insertSnapshot(userA.id, 60, 100000, 20000, 80000);
      await insertSnapshot(userA.id, 30, 110000, 25000, 85000);
      await insertSnapshot(userA.id, 0, 120000, 30000, 90000);
      await createAsset('Savings account', '999999.00');

      const result = await get('/api/wealth-analytics/net-worth');

      expect(result.status).toBe(200);
      const history = result.body.data.history;
      expect(history).toHaveLength(3);
      expect(history.map((point: { netWorth: number }) => point.netWorth)).toEqual([
        80000, 85000, 90000,
      ]);
      expect(history[0].totalAssets).toBe(100000);
      expect(history[0].totalLiabilities).toBe(20000);
      expect(
        history.every(
          (point: { snapshotDate: string }, index: number, all: unknown[]) =>
            index === 0 ||
            new Date(point.snapshotDate).getTime() >=
              new Date((all[index - 1] as { snapshotDate: string }).snapshotDate).getTime()
        )
      ).toBe(true);
    });

    it('does not interpolate days without a snapshot', async () => {
      await insertSnapshot(userA.id, 60, 100000, 20000, 80000);
      await insertSnapshot(userA.id, 0, 120000, 30000, 90000);

      const result = await get('/api/wealth-analytics/net-worth');

      expect(result.body.data.history).toHaveLength(2);
      expect(result.body.data.history[0].snapshotDate).not.toBe(
        result.body.data.history[1].snapshotDate
      );
    });

    it('filters history by date range', async () => {
      await insertSnapshot(userA.id, 120, 100000, 20000, 80000);
      await insertSnapshot(userA.id, 10, 110000, 25000, 85000);
      await insertSnapshot(userA.id, 0, 120000, 30000, 90000);

      const dateFrom = startOfUtcDay(addUtcDays(new Date(), -30)).toISOString();
      const dateTo = startOfUtcDay(new Date()).toISOString();
      const result = await get(
        `/api/wealth-analytics/net-worth?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`
      );

      expect(result.status).toBe(200);
      expect(result.body.data.history).toHaveLength(2);
      expect(
        result.body.data.history.map((point: { netWorth: number }) => point.netWorth)
      ).toEqual([85000, 90000]);
      expect(result.body.data.range.dateFrom).toBe(dateFrom);
      expect(result.body.data.range.dateTo).toBe(dateTo);
      expect(result.body.data.range.timezone).toBe('UTC');
    });

    it('defaults to the last 12 months when no range is supplied', async () => {
      const result = await get('/api/wealth-analytics/net-worth');

      const dateTo = new Date(result.body.data.range.dateTo);
      const dateFrom = new Date(result.body.data.range.dateFrom);
      const spanDays = (dateTo.getTime() - dateFrom.getTime()) / 86400000;
      const today = startOfUtcDay(new Date());

      expect(result.body.data.range.dateTo).toBe(today.toISOString());
      expect(spanDays).toBe(365);
    });

    it('derives net worth change as latest minus earliest', async () => {
      await insertSnapshot(userA.id, 60, 100000, 20000, 80000);
      await insertSnapshot(userA.id, 0, 120000, 30000, 90000);

      const result = await get('/api/wealth-analytics/net-worth');

      expect(result.body.data.change).toEqual({ absolute: 10000, percentage: 12.5 });
    });

    it('omits percentage change when the earliest net worth is not positive', async () => {
      await insertSnapshot(userA.id, 60, 1000, 6000, -5000);
      await insertSnapshot(userA.id, 0, 6000, 5000, 1000);

      const result = await get('/api/wealth-analytics/net-worth');

      expect(result.body.data.change.absolute).toBe(6000);
      expect(result.body.data.change.percentage).toBeNull();
    });

    it('omits percentage change when the earliest net worth is zero', async () => {
      await insertSnapshot(userA.id, 60, 5000, 5000, 0);
      await insertSnapshot(userA.id, 0, 8000, 5000, 3000);

      const result = await get('/api/wealth-analytics/net-worth');

      expect(result.body.data.change.absolute).toBe(3000);
      expect(result.body.data.change.percentage).toBeNull();
    });

    it('returns a null change with a single snapshot', async () => {
      await insertSnapshot(userA.id, 0, 120000, 30000, 90000);

      const result = await get('/api/wealth-analytics/net-worth');

      expect(result.body.data.history).toHaveLength(1);
      expect(result.body.data.change).toEqual({ absolute: null, percentage: null });
    });

    it('never creates a snapshot while reading analytics', async () => {
      await createAsset('Savings account', '155000.50');
      await createLiability('Credit card', '35000.00');
      const before = await testPrisma.wealthSnapshot.count({
        where: { userId: userA.id },
      });

      await get('/api/wealth-analytics/summary');
      await get('/api/wealth-analytics/net-worth');
      await get('/api/wealth-analytics/assets');
      await get('/api/wealth-analytics/liabilities');
      await get('/api/wealth-analytics/cash-flow');

      const after = await testPrisma.wealthSnapshot.count({
        where: { userId: userA.id },
      });
      expect(after).toBe(before);
      expect(after).toBe(0);
    });

    it('isolates history per user', async () => {
      await insertSnapshot(userA.id, 10, 110000, 25000, 85000);
      await insertSnapshot(userA.id, 0, 120000, 30000, 90000);

      const result = await get('/api/wealth-analytics/net-worth', tokenB);

      expect(result.status).toBe(200);
      expect(result.body.data.history).toEqual([]);
      expect(result.body.data.change).toEqual({ absolute: null, percentage: null });
    });

    it('rejects a reversed date range', async () => {
      const dateFrom = startOfUtcDay(addUtcDays(new Date(), 10)).toISOString();
      const dateTo = startOfUtcDay(new Date()).toISOString();

      const result = await get(
        `/api/wealth-analytics/net-worth?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`
      );

      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a range wider than the maximum', async () => {
      const dateFrom = startOfUtcDay(addUtcDays(new Date(), -3000)).toISOString();

      const result = await get(
        `/api/wealth-analytics/net-worth?dateFrom=${encodeURIComponent(dateFrom)}`
      );

      expect(result.status).toBe(400);
    });

    it('rejects an invalid date', async () => {
      const result = await get('/api/wealth-analytics/net-worth?dateFrom=not-a-date');

      expect(result.status).toBe(400);
    });

    it('rejects unknown query parameters on range endpoints', async () => {
      const result = await get('/api/wealth-analytics/net-worth?netWorth=999999');

      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('asset analytics', () => {
    it('returns allocation rows and grouped type totals with percentages', async () => {
      await createAsset('Family home', '50000.00', 'PROPERTY');
      await createAsset('Savings account', '30000.00', 'BANK_ACCOUNT');
      await createAsset('Gold coins', '20000.00', 'GOLD');

      const result = await get('/api/wealth-analytics/assets');

      expect(result.status).toBe(200);
      const data = result.body.data;
      expect(data.totalAssets).toBe(100000);
      expect(data.assetCount).toBe(3);
      expect(data.byType).toEqual([
        { type: 'PROPERTY', totalValue: 50000, percentage: 50 },
        { type: 'BANK_ACCOUNT', totalValue: 30000, percentage: 30 },
        { type: 'GOLD', totalValue: 20000, percentage: 20 },
      ]);
      expect(data.assets).toHaveLength(3);
      expect(data.assets[0]).toEqual({
        id: expect.any(String),
        name: 'Family home',
        type: 'PROPERTY',
        currentValue: 50000,
        percentage: 50,
      });
      const percentages = data.assets.map(
        (asset: { percentage: number }) => asset.percentage
      );
      expect(percentages.reduce((sum: number, value: number) => sum + value, 0)).toBe(
        100
      );
    });

    it('groups assets that share a type into one row', async () => {
      await createAsset('Checking', '10000.00', 'BANK_ACCOUNT');
      await createAsset('Savings', '20000.00', 'BANK_ACCOUNT');
      await createAsset('Family home', '30000.00', 'PROPERTY');

      const result = await get('/api/wealth-analytics/assets');

      expect(result.body.data.byType).toEqual([
        { type: 'BANK_ACCOUNT', totalValue: 30000, percentage: 50 },
        { type: 'PROPERTY', totalValue: 30000, percentage: 50 },
      ]);
      expect(result.body.data.byType[0].type).toBe('BANK_ACCOUNT');
    });

    it('returns zero percentages when total assets are zero', async () => {
      await createAsset('Old device', '0.00', 'OTHER');

      const result = await get('/api/wealth-analytics/assets');

      expect(result.body.data.totalAssets).toBe(0);
      expect(result.body.data.assetCount).toBe(1);
      expect(result.body.data.byType[0].percentage).toBe(0);
      expect(result.body.data.assets[0].percentage).toBe(0);
    });

    it('returns an empty allocation when the user has no assets', async () => {
      const result = await get('/api/wealth-analytics/assets');

      expect(result.status).toBe(200);
      expect(result.body.data).toEqual({
        totalAssets: 0,
        assetCount: 0,
        byType: [],
        assets: [],
      });
    });

    it('keeps Decimal precision in allocation percentages', async () => {
      await createAsset('A', '33.33');
      await createAsset('B', '33.33');
      await createAsset('C', '33.34');

      const result = await get('/api/wealth-analytics/assets');

      expect(result.body.data.totalAssets).toBe(100);
      expect(
        result.body.data.assets.map((asset: { percentage: number }) => asset.percentage)
      ).toEqual([33.34, 33.33, 33.33]);
    });

    it('isolates asset analytics per user', async () => {
      await createAsset('Savings account', '155000.50');

      const result = await get('/api/wealth-analytics/assets', tokenB);

      expect(result.status).toBe(200);
      expect(result.body.data.assetCount).toBe(0);
      expect(result.body.data.assets).toEqual([]);
    });

    it('does not modify assets while reading analytics', async () => {
      const id = await createAsset('Savings account', '155000.50');
      const before = await testPrisma.asset.findUnique({ where: { id } });

      await get('/api/wealth-analytics/assets');

      const after = await testPrisma.asset.findUnique({ where: { id } });
      expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
      expect(after?.currentValue.toNumber()).toBe(155000.5);
    });
  });

  describe('liability analytics', () => {
    it('returns composition rows and grouped type totals with percentages', async () => {
      await createLiability('Home loan', '60000.00', 'HOME_LOAN');
      await createLiability('Credit card', '40000.00', 'CREDIT_CARD');

      const result = await get('/api/wealth-analytics/liabilities');

      expect(result.status).toBe(200);
      const data = result.body.data;
      expect(data.totalLiabilities).toBe(100000);
      expect(data.liabilityCount).toBe(2);
      expect(data.byType).toEqual([
        { type: 'HOME_LOAN', totalBalance: 60000, percentage: 60 },
        { type: 'CREDIT_CARD', totalBalance: 40000, percentage: 40 },
      ]);
      expect(data.liabilities[0]).toEqual({
        id: expect.any(String),
        name: 'Home loan',
        type: 'HOME_LOAN',
        outstandingBalance: 60000,
        percentage: 60,
      });
      const percentages = data.liabilities.map(
        (liability: { percentage: number }) => liability.percentage
      );
      expect(percentages.reduce((sum: number, value: number) => sum + value, 0)).toBe(
        100
      );
    });

    it('groups liabilities that share a type into one row', async () => {
      await createLiability('Card A', '15000.00', 'CREDIT_CARD');
      await createLiability('Card B', '25000.00', 'CREDIT_CARD');
      await createLiability('Car loan', '60000.00', 'VEHICLE_LOAN');

      const result = await get('/api/wealth-analytics/liabilities');

      expect(result.body.data.byType).toEqual([
        { type: 'VEHICLE_LOAN', totalBalance: 60000, percentage: 60 },
        { type: 'CREDIT_CARD', totalBalance: 40000, percentage: 40 },
      ]);
    });

    it('returns zero percentages when total liabilities are zero', async () => {
      await createLiability('Cleared card', '0.00', 'CREDIT_CARD');

      const result = await get('/api/wealth-analytics/liabilities');

      expect(result.body.data.totalLiabilities).toBe(0);
      expect(result.body.data.byType[0].percentage).toBe(0);
      expect(result.body.data.liabilities[0].percentage).toBe(0);
    });

    it('returns an empty composition when the user has no liabilities', async () => {
      const result = await get('/api/wealth-analytics/liabilities');

      expect(result.status).toBe(200);
      expect(result.body.data).toEqual({
        totalLiabilities: 0,
        liabilityCount: 0,
        byType: [],
        liabilities: [],
      });
    });

    it('isolates liability analytics per user', async () => {
      await createLiability('Home loan', '60000.00', 'HOME_LOAN');

      const result = await get('/api/wealth-analytics/liabilities', tokenB);

      expect(result.status).toBe(200);
      expect(result.body.data.liabilityCount).toBe(0);
      expect(result.body.data.liabilities).toEqual([]);
    });

    it('does not modify liabilities while reading analytics', async () => {
      const id = await createLiability('Home loan', '60000.00', 'HOME_LOAN');
      const before = await testPrisma.liability.findUnique({ where: { id } });

      await get('/api/wealth-analytics/liabilities');

      const after = await testPrisma.liability.findUnique({ where: { id } });
      expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
      expect(after?.outstandingAmount.toNumber()).toBe(60000);
    });
  });

  describe('savings goal analytics', () => {
    it('returns active and completed counts with totals and progress', async () => {
      const active = await createGoal('Emergency fund', '200000.00');
      await contribute(active, '50000.00');
      const completed = await createGoal('New laptop', '10000.00');
      await contribute(completed, '10000.00');

      const data = await summary();

      expect(data.goals.goalCount).toBe(2);
      expect(data.goals.activeCount).toBe(1);
      expect(data.goals.completedCount).toBe(1);
      expect(data.goals.totalTargetAmount).toBe(210000);
      expect(data.goals.totalSavedAmount).toBe(60000);
      expect(data.goals.progressPercent).toBe(28.57);
      expect(data.goals.items).toHaveLength(2);
    });

    it('caps overall progress at 100 percent', async () => {
      const goalId = await createGoal('Tiny goal', '1000.00');
      await contribute(goalId, '1500.00');

      const data = await summary();

      expect(data.goals.totalSavedAmount).toBe(1500);
      expect(data.goals.progressPercent).toBe(100);
      expect(data.goals.items[0].progressPercent).toBe(100);
    });

    it('does not double-count contributions', async () => {
      const goalId = await createGoal('Emergency fund', '1000.00');
      await contribute(goalId, '300.00');
      await contribute(goalId, '200.00');

      const data = await summary();

      expect(data.goals.totalSavedAmount).toBe(500);
      expect(data.goals.items[0].currentAmount).toBe(500);
      expect(data.goals.items[0].progressPercent).toBe(50);
    });

    it('returns the goal breakdown with the canonical fields', async () => {
      const goalId = await createGoal('Emergency fund', '200000.00');
      await contribute(goalId, '50000.00');

      const data = await summary();

      const item = data.goals.items[0];
      expect(item).toEqual({
        goalId,
        name: 'Emergency fund',
        targetAmount: 200000,
        currentAmount: 50000,
        progressPercent: 25,
        targetDate: expect.any(String),
        status: 'ACTIVE',
      });
    });

    it('reports zero totals when there are no goals', async () => {
      const data = await summary();

      expect(data.goals).toMatchObject({
        goalCount: 0,
        activeCount: 0,
        completedCount: 0,
        totalTargetAmount: 0,
        totalSavedAmount: 0,
        progressPercent: 0,
        items: [],
      });
    });

    it('keeps goal contributions out of net worth', async () => {
      const goalId = await createGoal('Emergency fund', '200000.00');
      await contribute(goalId, '50000.00');

      const data = await summary();

      expect(data.goals.totalSavedAmount).toBe(50000);
      expect(data.current.netWorth).toBe(0);
      expect(data.current.totalAssets).toBe(0);
    });

    it('isolates goal analytics per user', async () => {
      const goalId = await createGoal('Emergency fund', '200000.00');
      await contribute(goalId, '50000.00');

      const other = await summary(tokenB);

      expect(other.goals.goalCount).toBe(0);
      expect(other.goals.totalSavedAmount).toBe(0);
      expect(other.goals.items).toEqual([]);
    });

    it('does not modify goals or contributions while reading analytics', async () => {
      const goalId = await createGoal('Emergency fund', '200000.00');
      await contribute(goalId, '50000.00');
      const before = await testPrisma.savingsGoal.findUnique({ where: { id: goalId } });
      const contributionsBefore = await testPrisma.goalContribution.count({
        where: { goalId },
      });

      await get('/api/wealth-analytics/summary');

      const after = await testPrisma.savingsGoal.findUnique({ where: { id: goalId } });
      const contributionsAfter = await testPrisma.goalContribution.count({
        where: { goalId },
      });
      expect(after?.status).toBe(before?.status);
      expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
      expect(contributionsAfter).toBe(contributionsBefore);
    });
  });

  describe('transaction cash-flow analytics', () => {
    it('computes income, expenses and net cash flow', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      const food = await createCategory('Food', 'EXPENSE');
      const rent = await createCategory('Rent', 'EXPENSE');
      await createTransaction(salary, 'INCOME', '100000.00', 10);
      await createTransaction(food, 'EXPENSE', '40000.00', 5);
      await createTransaction(rent, 'EXPENSE', '30000.00', 3);

      const result = await get('/api/wealth-analytics/cash-flow');

      expect(result.status).toBe(200);
      expect(result.body.data.income).toBe(100000);
      expect(result.body.data.expenses).toBe(70000);
      expect(result.body.data.net).toBe(30000);
      expect(result.body.data.transactionCount).toBe(3);
      expect(result.body.data.range.timezone).toBe('UTC');
    });

    it('filters cash flow by date range', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      const food = await createCategory('Food', 'EXPENSE');
      await createTransaction(salary, 'INCOME', '100000.00', 200);
      await createTransaction(food, 'EXPENSE', '40000.00', 5);

      const dateFrom = startOfUtcDay(addUtcDays(new Date(), -90)).toISOString();
      const dateTo = startOfUtcDay(new Date()).toISOString();
      const result = await get(
        `/api/wealth-analytics/cash-flow?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`
      );

      expect(result.body.data.income).toBe(0);
      expect(result.body.data.expenses).toBe(40000);
      expect(result.body.data.net).toBe(-40000);
      expect(result.body.data.transactionCount).toBe(1);
      expect(result.body.data.range.dateFrom).toBe(dateFrom);
    });

    it('includes an old transaction in the default 12 month range', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      await createTransaction(salary, 'INCOME', '100000.00', 200);

      const result = await get('/api/wealth-analytics/cash-flow');

      expect(result.body.data.income).toBe(100000);
      expect(result.body.data.transactionCount).toBe(1);
    });

    it('returns income and expense category breakdowns', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      const food = await createCategory('Food', 'EXPENSE');
      const rent = await createCategory('Rent', 'EXPENSE');
      await createTransaction(salary, 'INCOME', '100000.00', 10);
      await createTransaction(food, 'EXPENSE', '40000.00', 5);
      await createTransaction(rent, 'EXPENSE', '30000.00', 3);

      const result = await get('/api/wealth-analytics/cash-flow');

      expect(result.body.data.incomeByCategory).toEqual([
        {
          categoryId: salary,
          name: 'Salary',
          total: 100000,
          percentage: 100,
        },
      ]);
      expect(result.body.data.expenseByCategory).toEqual([
        { categoryId: food, name: 'Food', total: 40000, percentage: 57.14 },
        { categoryId: rent, name: 'Rent', total: 30000, percentage: 42.86 },
      ]);
    });

    it('reports zeros when there are no transactions', async () => {
      const result = await get('/api/wealth-analytics/cash-flow');

      expect(result.status).toBe(200);
      expect(result.body.data).toMatchObject({
        income: 0,
        expenses: 0,
        net: 0,
        transactionCount: 0,
        incomeByCategory: [],
        expenseByCategory: [],
      });
    });

    it('keeps cash flow separate from net worth change', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      const food = await createCategory('Food', 'EXPENSE');
      await createTransaction(salary, 'INCOME', '100000.00', 10);
      await createTransaction(food, 'EXPENSE', '50000.00', 5);

      const cashFlow = await get('/api/wealth-analytics/cash-flow');
      const summaryData = await summary();
      const history = await get('/api/wealth-analytics/net-worth');

      expect(cashFlow.body.data.net).toBe(50000);
      expect(summaryData.current.netWorth).toBe(0);
      expect(history.body.data.change.absolute).toBeNull();
    });

    it('isolates cash flow per user', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      await createTransaction(salary, 'INCOME', '100000.00', 10);

      const result = await get('/api/wealth-analytics/cash-flow', tokenB);

      expect(result.body.data.income).toBe(0);
      expect(result.body.data.transactionCount).toBe(0);
      expect(result.body.data.incomeByCategory).toEqual([]);
    });

    it('does not modify transactions while reading analytics', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      await createTransaction(salary, 'INCOME', '100000.00', 10);
      const before = await testPrisma.transaction.findMany({
        where: { userId: userA.id },
      });
      const beforeById = new Map(before.map((row) => [row.id, row]));

      await get('/api/wealth-analytics/cash-flow');
      await get('/api/wealth-analytics/cash-flow');

      const after = await testPrisma.transaction.findMany({
        where: { userId: userA.id },
      });
      expect(after).toHaveLength(beforeById.size);
      for (const row of after) {
        const original = beforeById.get(row.id);
        expect(original).toBeDefined();
        expect(row.updatedAt.toISOString()).toBe(original?.updatedAt.toISOString());
        expect(row.amount.toNumber()).toBe(100000);
      }
    });
  });

  describe('read-only security', () => {
    it('rejects anonymous requests on every endpoint', async () => {
      const paths = [
        '/api/wealth-analytics/summary',
        '/api/wealth-analytics/net-worth',
        '/api/wealth-analytics/assets',
        '/api/wealth-analytics/liabilities',
        '/api/wealth-analytics/cash-flow',
      ];

      for (const path of paths) {
        const result = await request(app).get(path);
        expect(result.status).toBe(401);
      }
    });

    it('exposes no write routes', async () => {
      const paths = [
        '/api/wealth-analytics/summary',
        '/api/wealth-analytics/net-worth',
        '/api/wealth-analytics/assets',
        '/api/wealth-analytics/liabilities',
        '/api/wealth-analytics/cash-flow',
      ];

      for (const path of paths) {
        const created = await post(path, {});
        expect(created.status).toBe(404);
        const patched = await request(app)
          .patch(path)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({});
        expect(patched.status).toBe(404);
        const deleted = await request(app)
          .delete(path)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(deleted.status).toBe(404);
      }
    });

    it('never accepts a client supplied userId', async () => {
      const summaryResult = await get(
        `/api/wealth-analytics/summary?userId=${userB.id}`
      );
      const cashFlowResult = await get(
        `/api/wealth-analytics/cash-flow?userId=${userB.id}`
      );

      expect(summaryResult.status).toBe(400);
      expect(cashFlowResult.status).toBe(400);
    });

    it('never accepts financial values as query input', async () => {
      const result = await get(
        '/api/wealth-analytics/cash-flow?income=100000&expenses=1'
      );

      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('never creates snapshots, notifications or records while reading analytics', async () => {
      await createAsset('Savings account', '155000.50');
      await createLiability('Credit card', '35000.00');
      const salary = await createCategory('Salary', 'INCOME');
      await createTransaction(salary, 'INCOME', '1000.00', 1);

      const snapshotsBefore = await testPrisma.wealthSnapshot.count();
      const notificationsBefore = await testPrisma.notification.count();
      const transactionsBefore = await testPrisma.transaction.count();
      const assetsBefore = await testPrisma.asset.count();
      const liabilitiesBefore = await testPrisma.liability.count();
      const goalsBefore = await testPrisma.savingsGoal.count();

      await get('/api/wealth-analytics/summary');
      await get('/api/wealth-analytics/net-worth');
      await get('/api/wealth-analytics/assets');
      await get('/api/wealth-analytics/liabilities');
      await get('/api/wealth-analytics/cash-flow');

      expect(await testPrisma.wealthSnapshot.count()).toBe(snapshotsBefore);
      expect(await testPrisma.notification.count()).toBe(notificationsBefore);
      expect(await testPrisma.transaction.count()).toBe(transactionsBefore);
      expect(await testPrisma.asset.count()).toBe(assetsBefore);
      expect(await testPrisma.liability.count()).toBe(liabilitiesBefore);
      expect(await testPrisma.savingsGoal.count()).toBe(goalsBefore);
    });

    it('keeps analytics read-only across a mixed dataset', async () => {
      await createAsset('Savings account', '155000.50');
      await createLiability('Credit card', '35000.00');
      const goalId = await createGoal('Emergency fund', '200000.00');
      await contribute(goalId, '50000.00');
      await insertSnapshot(userA.id, 0, 155000.5, 35000, 120000.5);

      const assetsBefore = await testPrisma.asset.findMany();
      const liabilitiesBefore = await testPrisma.liability.findMany();
      const goalsBefore = await testPrisma.savingsGoal.findMany();
      const snapshotsBefore = await testPrisma.wealthSnapshot.findMany();

      await get('/api/wealth-analytics/summary');
      await get('/api/wealth-analytics/net-worth');
      await get('/api/wealth-analytics/assets');
      await get('/api/wealth-analytics/liabilities');
      await get('/api/wealth-analytics/cash-flow');

      const assetsAfter = await testPrisma.asset.findMany();
      const liabilitiesAfter = await testPrisma.liability.findMany();
      const goalsAfter = await testPrisma.savingsGoal.findMany();
      const snapshotsAfter = await testPrisma.wealthSnapshot.findMany();

      expect(assetsAfter).toEqual(assetsBefore);
      expect(liabilitiesAfter).toEqual(liabilitiesBefore);
      expect(goalsAfter).toEqual(goalsBefore);
      expect(snapshotsAfter).toEqual(snapshotsBefore);
      expect(
        snapshotsAfter.every(
          (snapshot) => snapshot.netWorth.toNumber() === 120000.5
        )
      ).toBe(true);
    });

    it('does not leak user B totals into user A analytics', async () => {
      await createAsset('A savings', '155000.50', undefined, tokenA);
      await createAsset('B savings', '777000.00', undefined, tokenB);
      await createLiability('B card', '777000.00', undefined, tokenB);

      const assetsA = await get('/api/wealth-analytics/assets', tokenA);
      const summaryA = await summary(tokenA);

      expect(assetsA.body.data.totalAssets).toBe(155000.5);
      expect(assetsA.body.data.assetCount).toBe(1);
      expect(summaryA.current.totalAssets).toBe(155000.5);
      expect(summaryA.current.netWorth).toBe(155000.5);
    });
  });

  describe('transaction types', () => {
    it('counts only income and expense transactions in cash flow', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      await createTransaction(salary, 'INCOME', '100000.00', 4);

      const result = await get('/api/wealth-analytics/cash-flow');

      expect(
        result.body.data.transactionCount
      ).toBe(1);
      const rows = await testPrisma.transaction.findMany({
        where: { userId: userA.id },
      });
      expect(rows[0].type).toBe(TransactionType.INCOME);
    });
  });
});
