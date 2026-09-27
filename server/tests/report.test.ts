import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, Frequency } from '@prisma/client';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import {
  assetRouter,
  liabilityRouter,
  summaryRouter,
} from '../src/routes/assetLiabilityRoutes.js';
import { wealthSnapshotRouter } from '../src/routes/wealthSnapshotRoutes.js';
import { wealthAnalyticsRouter } from '../src/routes/wealthAnalyticsRoutes.js';
import { reportRouter } from '../src/routes/reportRoutes.js';
import goalRoutes from '../src/routes/goalRoutes.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';
import { addUtcDays, startOfUtcDay } from '../src/utils/date.js';
import { escapeCsvCell, sanitizeCsvText } from '../src/services/reportCsvService.js';

const UTF8_BOM = '\uFEFF';

const REPORT_PATHS = [
  '/api/reports/financial',
  '/api/reports/financial.csv',
  '/api/reports/financial.pdf',
];

/**
 * pdfkit writes every glyph as its own hex code inside `TJ` arrays, so the
 * report text is reconstructed by decoding those hex runs. This is a read-only
 * assertion helper — it never parses or validates PDF structure beyond the
 * content streams.
 */
function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(
    (match) => match[1]
  );

  return streams
    .map((stream) => {
      let text = '';
      for (const match of stream.matchAll(/<([0-9A-Fa-f]+)>/g)) {
        const hex = match[1];
        for (let index = 0; index < hex.length; index += 2) {
          text += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
        }
      }
      return text;
    })
    .join('\n');
}

describe('Reports API', () => {
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
    app.use('/api/reports', reportRouter);
    app.use('/api/goals', goalRoutes);
    app.use('/api/categories', categoryRoutes);
    app.use('/api/transactions', transactionRoutes);
    app.use(notFoundHandler);
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

  function utcDaysAgo(days: number): string {
    return startOfUtcDay(addUtcDays(new Date(), -days)).toISOString();
  }

  function dayOnly(daysAgo: number): string {
    return utcDaysAgo(daysAgo).slice(0, 10);
  }

  function rangeQuery(days: number): string {
    return `?dateFrom=${encodeURIComponent(utcDaysAgo(days))}&dateTo=${encodeURIComponent(
      utcDaysAgo(0)
    )}`;
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
    const result = await post('/api/goals', { name, targetAmount, targetDate: '2027-06-30' }, token);
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
    const result = await post(
      '/api/transactions',
      { categoryId, type, amount, transactionDate: dayOnly(daysAgo) },
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

  /** Seeds the full mixed dataset used by most report assertions. */
  async function seedMixedData(): Promise<void> {
    const salary = await createCategory('Salary', 'INCOME');
    const food = await createCategory('Food', 'EXPENSE');
    const rent = await createCategory('Rent', 'EXPENSE');
    await createTransaction(salary, 'INCOME', '100000.00', 10);
    await createTransaction(salary, 'INCOME', '50000.00', 200);
    await createTransaction(food, 'EXPENSE', '40000.00', 5);
    await createTransaction(rent, 'EXPENSE', '30000.00', 3);

    await createAsset('Savings account', '150000.50', 'BANK_ACCOUNT');
    await createAsset('Cash wallet', '5000.00', 'CASH');
    await createLiability('Credit card', '35000.00', 'CREDIT_CARD');

    const emergency = await createGoal('Emergency fund', '200000.00');
    await contribute(emergency, '50000.00');
    const laptop = await createGoal('Laptop', '10000.00');
    await contribute(laptop, '10000.00');

    await insertSnapshot(userA.id, 30, 100000, 20000, 80000);
    await insertSnapshot(userA.id, 0, 155000.5, 35000, 120000.5);
  }

  async function report(query = '', token: string = tokenA) {
    const result = await get(`/api/reports/financial${query}`, token);
    expect(result.status).toBe(200);
    return result.body.data;
  }

  describe('date range', () => {
    it('accepts an explicit range and echoes it in the period', async () => {
      const data = await report(rangeQuery(90));

      expect(data.period.dateFrom).toBe(utcDaysAgo(90));
      expect(data.period.dateTo).toBe(utcDaysAgo(0));
      expect(data.period.timezone).toBe('UTC');
    });

    it('defaults to the last 365 days when no range is supplied', async () => {
      const data = await report();

      const from = new Date(data.period.dateFrom).getTime();
      const to = new Date(data.period.dateTo).getTime();
      expect((to - from) / 86400000).toBe(365);
      expect(data.period.dateTo).toBe(startOfUtcDay(new Date()).toISOString());
    });

    it('accepts the maximum 1825 day range', async () => {
      const result = await get(
        `/api/reports/financial?dateFrom=${encodeURIComponent(utcDaysAgo(1825))}`
      );

      expect(result.status).toBe(200);
      const data = result.body.data;
      const from = new Date(data.period.dateFrom).getTime();
      const to = new Date(data.period.dateTo).getTime();
      expect((to - from) / 86400000).toBe(1825);
    });

    it('rejects a range wider than 1825 days', async () => {
      const result = await get(
        `/api/reports/financial?dateFrom=${encodeURIComponent(utcDaysAgo(1826))}`
      );

      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a reversed range', async () => {
      const result = await get(
        `/api/reports/financial?dateFrom=${encodeURIComponent(
          utcDaysAgo(0)
        )}&dateTo=${encodeURIComponent(utcDaysAgo(30))}`
      );

      expect(result.status).toBe(400);
    });

    it('rejects an invalid date', async () => {
      const result = await get('/api/reports/financial?dateFrom=not-a-date');

      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unknown query parameters', async () => {
      const result = await get('/api/reports/financial?netWorth=999999');

      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('applies UTC calendar-day semantics to transactions', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      await createTransaction(salary, 'INCOME', '100000.00', 10);
      await createTransaction(salary, 'INCOME', '50000.00', 200);

      const wide = await report(rangeQuery(365));
      const narrow = await report(rangeQuery(7));

      expect(wide.overview.income).toBe(150000);
      expect(wide.overview.transactionCount).toBe(2);
      expect(narrow.overview.income).toBe(0);
      expect(narrow.overview.transactionCount).toBe(0);
    });

    it('includes the end day of the selected range', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      await createTransaction(salary, 'INCOME', '1000.00', 0);

      const data = await report(rangeQuery(7));

      expect(data.overview.income).toBe(1000);
    });
  });

  describe('financial overview', () => {
    it('returns income, expenses, net cash flow, assets, liabilities and net worth', async () => {
      await seedMixedData();

      const data = await report();

      expect(data.overview).toEqual({
        income: 150000,
        expenses: 70000,
        netCashFlow: 80000,
        transactionCount: 4,
        totalAssets: 155000.5,
        totalLiabilities: 35000,
        netWorth: 120000.5,
        activeGoalCount: 1,
        completedGoalCount: 1,
        totalGoalTarget: 210000,
        totalGoalSaved: 60000,
        goalProgressPercent: 28.57,
      });
    });

    it('reports zeroed overview figures for an empty account', async () => {
      const data = await report();

      expect(data.overview).toEqual({
        income: 0,
        expenses: 0,
        netCashFlow: 0,
        transactionCount: 0,
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
        activeGoalCount: 0,
        completedGoalCount: 0,
        totalGoalTarget: 0,
        totalGoalSaved: 0,
        goalProgressPercent: 0,
      });
    });

    it('keeps cash flow and net worth conceptually separate', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      const food = await createCategory('Food', 'EXPENSE');
      await createTransaction(salary, 'INCOME', '100000.00', 10);
      await createTransaction(food, 'EXPENSE', '50000.00', 5);

      const data = await report();

      expect(data.overview.netCashFlow).toBe(50000);
      expect(data.overview.netWorth).toBe(0);
      expect(data.netWorthHistory).toEqual([]);
    });

    it('never treats goal contributions as assets or net worth', async () => {
      const goalId = await createGoal('Emergency fund', '200000.00');
      await contribute(goalId, '50000.00');
      await createAsset('Savings account', '5000.00');

      const data = await report();

      expect(data.overview.totalGoalSaved).toBe(50000);
      expect(data.overview.totalAssets).toBe(5000);
      expect(data.overview.netWorth).toBe(5000);
    });

    it('keeps Decimal precision at two places', async () => {
      await createAsset('A', '0.10');
      await createAsset('B', '0.20');
      await createAsset('C', '33.33');
      await createLiability('Card', '10.00');

      const data = await report();

      expect(data.overview.totalAssets).toBe(33.63);
      expect(data.overview.netWorth).toBe(23.63);
    });

    it('returns a negative net worth when liabilities exceed assets', async () => {
      await createAsset('Old phone', '1000.00');
      await createLiability('Credit card', '40000.00', 'CREDIT_CARD');

      const data = await report();

      expect(data.overview.netWorth).toBe(-39000);
      expect(data.overview.totalLiabilities).toBe(40000);
    });

    it('matches the wealth analytics summary exactly', async () => {
      await seedMixedData();

      const data = await report();
      const analytics = await get('/api/wealth-analytics/summary');

      expect(analytics.status).toBe(200);
      expect(data.overview.totalAssets).toBe(analytics.body.data.current.totalAssets);
      expect(data.overview.totalLiabilities).toBe(
        analytics.body.data.current.totalLiabilities
      );
      expect(data.overview.netWorth).toBe(analytics.body.data.current.netWorth);
      expect(data.overview.totalGoalSaved).toBe(analytics.body.data.goals.totalSavedAmount);
      expect(data.overview.goalProgressPercent).toBe(
        analytics.body.data.goals.progressPercent
      );
    });

    it('matches the Phase 5C net worth summary exactly', async () => {
      await createAsset('Savings account', '155000.50');
      await createLiability('Credit card', '35000.25');

      const data = await report();
      const phase5c = await get('/api/assets-liabilities/summary');

      expect(phase5c.status).toBe(200);
      expect(data.overview.totalAssets).toBe(phase5c.body.data.totalAssets);
      expect(data.overview.totalLiabilities).toBe(phase5c.body.data.totalLiabilities);
      expect(data.overview.netWorth).toBe(phase5c.body.data.netWorth);
    });
  });

  describe('income, expenses and categories', () => {
    it('reports income, expenses and net cash flow for the range', async () => {
      await seedMixedData();

      const data = await report(rangeQuery(90));

      expect(data.overview.income).toBe(100000);
      expect(data.overview.expenses).toBe(70000);
      expect(data.overview.netCashFlow).toBe(30000);
      expect(data.overview.transactionCount).toBe(3);
    });

    it('breaks income down by category with percentages', async () => {
      await seedMixedData();

      const data = await report();

      expect(data.incomeCategories).toEqual([
        { categoryId: expect.any(String), name: 'Salary', total: 150000, percentage: 100 },
      ]);
    });

    it('breaks expenses down by category with percentages', async () => {
      await seedMixedData();

      const data = await report();

      expect(data.expenseCategories).toEqual([
        { categoryId: expect.any(String), name: 'Food', total: 40000, percentage: 57.14 },
        { categoryId: expect.any(String), name: 'Rent', total: 30000, percentage: 42.86 },
      ]);
    });

    it('returns empty category lists when there are no transactions', async () => {
      const data = await report();

      expect(data.incomeCategories).toEqual([]);
      expect(data.expenseCategories).toEqual([]);
      expect(data.overview.transactionCount).toBe(0);
    });

    it('matches the wealth analytics cash-flow breakdown', async () => {
      await seedMixedData();

      const data = await report();
      const cashFlow = await get('/api/wealth-analytics/cash-flow');

      expect(cashFlow.status).toBe(200);
      expect(data.incomeCategories).toEqual(
        cashFlow.body.data.incomeByCategory.map(
          (row: { categoryId: string; name: string; total: number; percentage: number }) => ({
            categoryId: row.categoryId,
            name: row.name,
            total: row.total,
            percentage: row.percentage,
          })
        )
      );
      expect(data.expenseCategories).toEqual(
        cashFlow.body.data.expenseByCategory.map(
          (row: { categoryId: string; name: string; total: number; percentage: number }) => ({
            categoryId: row.categoryId,
            name: row.name,
            total: row.total,
            percentage: row.percentage,
          })
        )
      );
    });
  });

  describe('assets and liabilities', () => {
    it('returns the current asset position with counts, types and items', async () => {
      await seedMixedData();

      const data = await report();

      expect(data.assets.assetCount).toBe(2);
      expect(data.assets.totalAssets).toBe(155000.5);
      expect(data.assets.byType).toEqual([
        { type: 'BANK_ACCOUNT', totalValue: 150000.5, percentage: 96.77 },
        { type: 'CASH', totalValue: 5000, percentage: 3.23 },
      ]);
      expect(data.assets.assets).toHaveLength(2);
      expect(data.assets.assets.map((asset) => asset.name).sort()).toEqual([
        'Cash wallet',
        'Savings account',
      ]);
    });

    it('returns the current liability position with counts, types and items', async () => {
      await seedMixedData();

      const data = await report();

      expect(data.liabilities.liabilityCount).toBe(1);
      expect(data.liabilities.totalLiabilities).toBe(35000);
      expect(data.liabilities.byType).toEqual([
        { type: 'CREDIT_CARD', totalBalance: 35000, percentage: 100 },
      ]);
      expect(data.liabilities.liabilities[0]).toEqual({
        id: expect.any(String),
        name: 'Credit card',
        type: 'CREDIT_CARD',
        outstandingBalance: 35000,
        percentage: 100,
      });
    });

    it('returns empty asset and liability sections for a new account', async () => {
      const data = await report();

      expect(data.assets).toEqual({
        totalAssets: 0,
        assetCount: 0,
        byType: [],
        assets: [],
      });
      expect(data.liabilities).toEqual({
        totalLiabilities: 0,
        liabilityCount: 0,
        byType: [],
        liabilities: [],
      });
    });

    it('uses current balances regardless of the selected period', async () => {
      await createAsset('Savings account', '150000.50', 'BANK_ACCOUNT');
      await insertSnapshot(userA.id, 60, 10000, 1000, 9000);

      const data = await report(rangeQuery(7));

      expect(data.assets.totalAssets).toBe(150000.5);
      expect(data.netWorthHistory).toEqual([]);
    });

    it('matches the wealth analytics asset and liability sections', async () => {
      await seedMixedData();

      const data = await report();
      const assets = await get('/api/wealth-analytics/assets');
      const liabilities = await get('/api/wealth-analytics/liabilities');

      expect(data.assets).toEqual(assets.body.data);
      expect(data.liabilities).toEqual(liabilities.body.data);
    });
  });

  describe('net worth', () => {
    it('reports the current net worth from live assets and liabilities', async () => {
      await seedMixedData();

      const data = await report();

      expect(data.overview.netWorth).toBe(120000.5);
      expect(data.overview.netWorth).toBe(155000.5 - 35000);
    });

    it('returns snapshot history in the range without interpolation', async () => {
      await seedMixedData();

      const data = await report();

      expect(data.netWorthHistory).toHaveLength(2);
      expect(data.netWorthHistory[0]).toEqual({
        snapshotDate: expect.any(String),
        totalAssets: 100000,
        totalLiabilities: 20000,
        netWorth: 80000,
      });
      expect(data.netWorthHistory[1].netWorth).toBe(120000.5);
    });

    it('filters snapshots by the selected range', async () => {
      await seedMixedData();

      const data = await report(rangeQuery(7));

      expect(data.netWorthHistory).toHaveLength(1);
      expect(data.netWorthHistory[0].netWorth).toBe(120000.5);
    });

    it('returns an empty history when no snapshots exist', async () => {
      await createAsset('Savings account', '5000.00');

      const data = await report();

      expect(data.netWorthHistory).toEqual([]);
      expect(data.overview.netWorth).toBe(5000);
    });

    it('never reconstructs history from current assets or transactions', async () => {
      const salary = await createCategory('Salary', 'INCOME');
      await createTransaction(salary, 'INCOME', '999999.00', 400);
      await createAsset('Savings account', '5000.00');

      const data = await report();

      expect(data.netWorthHistory).toEqual([]);
      expect(data.overview.totalAssets).toBe(5000);
    });

    it('keeps stored snapshot values unchanged', async () => {
      await insertSnapshot(userA.id, 30, 100000, 20000, 80000);
      const before = await testPrisma.wealthSnapshot.findMany({
        where: { userId: userA.id },
      });

      await report();
      await get('/api/reports/financial.csv');
      await get('/api/reports/financial.pdf');

      const after = await testPrisma.wealthSnapshot.findMany({
        where: { userId: userA.id },
      });
      expect(after).toEqual(before);
    });
  });

  describe('savings goals', () => {
    it('returns the goal summary with counts, totals and progress', async () => {
      await seedMixedData();

      const data = await report();

      expect(data.goals.goalCount).toBe(2);
      expect(data.goals.activeCount).toBe(1);
      expect(data.goals.completedCount).toBe(1);
      expect(data.goals.totalTargetAmount).toBe(210000);
      expect(data.goals.totalSavedAmount).toBe(60000);
      expect(data.goals.progressPercent).toBe(28.57);
      expect(data.goals.items).toHaveLength(2);
    });

    it('returns per-goal progress using the shared goal algorithm', async () => {
      const goalId = await createGoal('Emergency fund', '200000.00');
      await contribute(goalId, '50000.00');

      const data = await report();

      expect(data.goals.items[0]).toEqual({
        goalId,
        name: 'Emergency fund',
        targetAmount: 200000,
        currentAmount: 50000,
        progressPercent: 25,
        targetDate: expect.any(String),
        status: 'ACTIVE',
      });
    });

    it('caps goal progress at 100 percent', async () => {
      const goalId = await createGoal('Tiny goal', '1000.00');
      await contribute(goalId, '1500.00');

      const data = await report();

      expect(data.goals.totalSavedAmount).toBe(1500);
      expect(data.goals.progressPercent).toBe(100);
    });

    it('returns an empty goal section for a new account', async () => {
      const data = await report();

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

    it('matches the wealth analytics goal summary', async () => {
      await seedMixedData();

      const data = await report();
      const analytics = await get('/api/wealth-analytics/summary');

      expect(data.goals).toEqual(analytics.body.data.goals);
    });
  });

  describe('read-only guarantee', () => {
    it('rejects anonymous requests on every endpoint', async () => {
      for (const path of REPORT_PATHS) {
        const result = await request(app).get(path);
        expect(result.status).toBe(401);
      }
    });

    it('exposes no write routes', async () => {
      for (const path of REPORT_PATHS) {
        expect((await post(path, {})).status).toBe(404);
        expect(
          (
            await request(app)
              .patch(path)
              .set('Authorization', `Bearer ${tokenA}`)
              .send({})
          ).status
        ).toBe(404);
        expect(
          (
            await request(app)
              .delete(path)
              .set('Authorization', `Bearer ${tokenA}`)
          ).status
        ).toBe(404);
      }
    });

    it('never accepts a client supplied userId', async () => {
      for (const path of REPORT_PATHS) {
        const result = await get(`${path}?userId=${userB.id}`);
        expect(result.status).toBe(400);
        expect(result.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('never accepts financial values as query input', async () => {
      const result = await get('/api/reports/financial?income=100000&netWorth=1');

      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('does not create snapshots, notifications or records', async () => {
      await seedMixedData();

      const snapshotsBefore = await testPrisma.wealthSnapshot.count();
      const notificationsBefore = await testPrisma.notification.count();
      const transactionsBefore = await testPrisma.transaction.count();
      const assetsBefore = await testPrisma.asset.count();
      const liabilitiesBefore = await testPrisma.liability.count();
      const goalsBefore = await testPrisma.savingsGoal.count();
      const contributionsBefore = await testPrisma.goalContribution.count();

      for (const path of REPORT_PATHS) {
        await get(path);
      }

      expect(await testPrisma.wealthSnapshot.count()).toBe(snapshotsBefore);
      expect(await testPrisma.notification.count()).toBe(notificationsBefore);
      expect(await testPrisma.transaction.count()).toBe(transactionsBefore);
      expect(await testPrisma.asset.count()).toBe(assetsBefore);
      expect(await testPrisma.liability.count()).toBe(liabilitiesBefore);
      expect(await testPrisma.savingsGoal.count()).toBe(goalsBefore);
      expect(await testPrisma.goalContribution.count()).toBe(contributionsBefore);
    });

    it('never mutates the rows it reads', async () => {
      await seedMixedData();

      const assetsBefore = await testPrisma.asset.findMany({ orderBy: { id: 'asc' } });
      const liabilitiesBefore = await testPrisma.liability.findMany({ orderBy: { id: 'asc' } });
      const goalsBefore = await testPrisma.savingsGoal.findMany({ orderBy: { id: 'asc' } });
      const transactionsBefore = await testPrisma.transaction.findMany({
        orderBy: { id: 'asc' },
      });

      for (const path of REPORT_PATHS) {
        await get(path);
      }

      expect(await testPrisma.asset.findMany({ orderBy: { id: 'asc' } })).toEqual(
        assetsBefore
      );
      expect(await testPrisma.liability.findMany({ orderBy: { id: 'asc' } })).toEqual(
        liabilitiesBefore
      );
      expect(await testPrisma.savingsGoal.findMany({ orderBy: { id: 'asc' } })).toEqual(
        goalsBefore
      );
      expect(await testPrisma.transaction.findMany({ orderBy: { id: 'asc' } })).toEqual(
        transactionsBefore
      );
    });

    it('never modifies budgets, bills or subscriptions', async () => {
      const month = startOfUtcDay(addUtcDays(new Date(), -10));
      const budget = await testPrisma.budget.create({
        data: { userId: userA.id, name: 'Monthly', amount: 50000, month },
      });
      const bill = await testPrisma.bill.create({
        data: {
          userId: userA.id,
          name: 'Electricity',
          amount: 2500,
          frequency: Frequency.MONTHLY,
          dueDate: addUtcDays(new Date(), 5),
          nextDueDate: addUtcDays(new Date(), 5),
        },
      });
      const subscription = await testPrisma.subscription.create({
        data: {
          userId: userA.id,
          name: 'Streaming',
          amount: 500,
          billingCycle: Frequency.MONTHLY,
          nextRenewalDate: addUtcDays(new Date(), 10),
        },
      });

      for (const path of REPORT_PATHS) {
        await get(path);
      }

      expect(
        await testPrisma.budget.findUnique({ where: { id: budget.id } })
      ).toEqual(budget);
      expect(await testPrisma.bill.findUnique({ where: { id: bill.id } })).toEqual(bill);
      expect(await testPrisma.subscription.findUnique({ where: { id: subscription.id } })).toEqual(
        subscription
      );
    });
  });

  describe('user isolation', () => {
    it('never leaks user A data into user B reports', async () => {
      await seedMixedData();

      const other = await report('', tokenB);

      expect(other.overview.income).toBe(0);
      expect(other.overview.totalAssets).toBe(0);
      expect(other.overview.netWorth).toBe(0);
      expect(other.incomeCategories).toEqual([]);
      expect(other.assets.assets).toEqual([]);
      expect(other.netWorthHistory).toEqual([]);
      expect(other.goals.goalCount).toBe(0);
    });

    it('keeps CSV output isolated per user', async () => {
      await seedMixedData();

      const mine = await get('/api/reports/financial.csv');
      const theirs = await get('/api/reports/financial.csv', tokenB);

      expect(mine.status).toBe(200);
      expect(mine.text).toContain('Savings account');
      expect(theirs.status).toBe(200);
      expect(theirs.text).not.toContain('Savings account');
      expect(theirs.text).toContain('Total income,0.00');
    });

    it('keeps PDF output isolated per user', async () => {
      await seedMixedData();

      const mine = await get('/api/reports/financial.pdf');
      const theirs = await get('/api/reports/financial.pdf', tokenB);

      expect(mine.status).toBe(200);
      expect(extractPdfText(mine.body)).toContain('150000.00');
      expect(theirs.status).toBe(200);
      expect(extractPdfText(theirs.body)).not.toContain('150000.00');
      expect(extractPdfText(theirs.body)).toContain('Total income0.00');
    });
  });

  describe('CSV export', () => {
    it('returns CSV with the right content type and deterministic filename', async () => {
      const result = await get('/api/reports/financial.csv');

      expect(result.status).toBe(200);
      expect(result.headers['content-type']).toContain('text/csv');
      expect(result.headers['content-type']).toContain('charset=utf-8');
      expect(result.headers['content-disposition']).toBe(
        `attachment; filename="wealthhabit-financial-report-${utcDaysAgo(0).slice(
          0,
          10
        )}.csv"`
      );
    });

    it('starts with a UTF-8 byte-order mark', async () => {
      const result = await get('/api/reports/financial.csv');

      expect(result.text.startsWith(UTF8_BOM)).toBe(true);
    });

    it('contains readable section headings and column headers', async () => {
      await seedMixedData();

      const csv = (await get('/api/reports/financial.csv')).text;

      expect(csv).toContain('WealthHabit Financial Report');
      expect(csv).toContain('Financial Overview');
      expect(csv).toContain('Metric,Value');
      expect(csv).toContain('Income Categories');
      expect(csv).toContain('Category,Total,Share (%)');
      expect(csv).toContain('Expense Categories');
      expect(csv).toContain('Current Asset Position');
      expect(csv).toContain('Asset,Type,Current value,Share (%)');
      expect(csv).toContain('Current Liability Position');
      expect(csv).toContain('Net Worth');
      expect(csv).toContain('Snapshot date,Total assets,Total liabilities,Net worth');
      expect(csv).toContain('Savings Goals');
      expect(csv).toContain('Goal,Status,Target,Saved,Progress (%),Target date');
    });

    it('contains the same totals as the JSON report', async () => {
      await seedMixedData();

      const json = await report();
      const csv = (await get('/api/reports/financial.csv')).text;

      expect(csv).toContain(`Total income,${json.overview.income.toFixed(2)}`);
      expect(csv).toContain(`Total expenses,${json.overview.expenses.toFixed(2)}`);
      expect(csv).toContain(`Net cash flow,${json.overview.netCashFlow.toFixed(2)}`);
      expect(csv).toContain(
        `Current net worth,${json.overview.netWorth.toFixed(2)}`
      );
      expect(csv).toContain(
        `Total goal saved,${json.overview.totalGoalSaved.toFixed(2)}`
      );
      expect(csv).toContain(`Salary,${json.incomeCategories[0].total.toFixed(2)},100.00`);
    });

    it('escapes commas and quotes in user-controlled names', async () => {
      await createAsset('Wallet, "primary"', '1000.00', 'CASH');

      const csv = (await get('/api/reports/financial.csv')).text;

      expect(csv).toContain('"Wallet, ""primary"""');
    });

    it('escapes commas, quotes and line breaks in a single cell', () => {
      expect(escapeCsvCell('Hello, world')).toBe('"Hello, world"');
      expect(escapeCsvCell('He said "hello"')).toBe('"He said ""hello"""');
      expect(escapeCsvCell('Line one\nLine two')).toBe('"Line one\nLine two"');
      expect(escapeCsvCell('plain')).toBe('plain');
    });

    it('neutralises formula prefixes only in user-controlled text', () => {
      expect(sanitizeCsvText('=1+1')).toBe("'=1+1");
      expect(sanitizeCsvText('+cmd')).toBe("'+cmd");
      expect(sanitizeCsvText('@import')).toBe("'@import");
      expect(sanitizeCsvText('-1500')).toBe("'-1500");
      expect(sanitizeCsvText('Salary')).toBe('Salary');
    });

    it('protects against spreadsheet formula injection in text fields', async () => {
      await createAsset('=SUM(A1:A9)', '1000.00', 'CASH');
      await createAsset('+1234', '1000.00', 'CASH');
      await createAsset('@import', '1000.00', 'CASH');
      await createAsset('-cmd', '1000.00', 'CASH');

      const csv = (await get('/api/reports/financial.csv')).text;

      expect(csv).toContain("'=SUM(A1:A9)");
      expect(csv).toContain("'+1234");
      expect(csv).toContain("'@import");
      expect(csv).toContain("'-cmd");
      expect(csv).not.toMatch(/(^|,)=SUM/m);
    });

    it('keeps negative amounts as real negative numbers', async () => {
      await createAsset('Old phone', '1000.00');
      await createLiability('Credit card', '40000.00');

      const csv = (await get('/api/reports/financial.csv')).text;

      expect(csv).toContain('Current net worth,-39000.00');
      expect(csv).not.toContain("'-39000.00");
    });

    it('formats Decimal values with exactly two decimals', async () => {
      await createAsset('A', '0.10');
      await createAsset('B', '0.20');
      await createAsset('C', '33.33');
      await createLiability('Card', '10.00');

      const csv = (await get('/api/reports/financial.csv')).text;

      expect(csv).toContain('Total assets,33.63');
      expect(csv).toContain('Current net worth,23.63');
      expect(csv).toContain('Total liabilities,10.00');
    });

    it('renders an empty report instead of failing', async () => {
      const result = await get('/api/reports/financial.csv');

      expect(result.status).toBe(200);
      expect(result.text).toContain('Total income,0.00');
      expect(result.text).toContain('No income in the selected period');
      expect(result.text).toContain('No wealth snapshots in the selected period');
      expect(result.text).toContain('No savings goals yet');
    });

    it('applies the same date range as the JSON report', async () => {
      await seedMixedData();

      const json = await report(rangeQuery(7));
      const csv = (await get(`/api/reports/financial.csv${rangeQuery(7)}`)).text;

      expect(csv).toContain(`Period start,${utcDaysAgo(7).slice(0, 10)}`);
      expect(csv).toContain(`Total income,${json.overview.income.toFixed(2)}`);
      expect(json.overview.income).toBe(0);
    });

    it('rejects anonymous requests and userId injection', async () => {
      const anonymous = await request(app).get('/api/reports/financial.csv');
      const injected = await get(`/api/reports/financial.csv?userId=${userB.id}`);

      expect(anonymous.status).toBe(401);
      expect(injected.status).toBe(400);
    });
  });

  describe('PDF export', () => {
    it('returns a valid PDF with the right content type', async () => {
      const result = await get('/api/reports/financial.pdf');

      expect(result.status).toBe(200);
      expect(result.headers['content-type']).toContain('application/pdf');
      expect(result.headers['content-disposition']).toContain(
        `filename="wealthhabit-financial-report-${utcDaysAgo(0).slice(0, 10)}.pdf"`
      );
      const pdf = result.body as Buffer;
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pdf.toString('latin1').includes('%%EOF')).toBe(true);
    });

    it('contains the title, period and generated date', async () => {
      const text = extractPdfText((await get('/api/reports/financial.pdf')).body);

      expect(text).toContain('WealthHabit');
      expect(text).toContain('Financial Report');
      expect(text).toContain(`Report period${utcDaysAgo(365).slice(0, 10)} to ${utcDaysAgo(0).slice(0, 10)}`);
      expect(text).toContain('Generated (UTC)');
      expect(text).toContain('Time zoneUTC');
    });

    it('contains the same report totals as the JSON report', async () => {
      await seedMixedData();

      const json = await report();
      const text = extractPdfText((await get('/api/reports/financial.pdf')).body);

      expect(text).toContain(`Total income${json.overview.income.toFixed(2)}`);
      expect(text).toContain(`Total expenses${json.overview.expenses.toFixed(2)}`);
      expect(text).toContain(`Net cash flow${json.overview.netCashFlow.toFixed(2)}`);
      expect(text).toContain(`Current net worth${json.overview.netWorth.toFixed(2)}`);
      expect(text).toContain('Current Asset Position');
      expect(text).toContain('Current Liability Position');
      expect(text).toContain('Savings Goals');
      expect(text).toContain('Income Categories');
      expect(text).toContain('Expense Categories');
      expect(text).toContain('Snapshot date');
    });

    it('contains category, asset, liability and goal rows', async () => {
      await seedMixedData();

      const text = extractPdfText((await get('/api/reports/financial.pdf')).body);

      expect(text).toContain('Salary150000.00');
      expect(text).toContain('Food40000.00');
      expect(text).toContain('Savings account');
      expect(text).toContain('Credit card');
      expect(text).toContain('Emergency fund');
      expect(text).toContain('ACTIVE');
      expect(text).toContain('COMPLETED');
    });

    it('renders negative amounts', async () => {
      await createAsset('Old phone', '1000.00');
      await createLiability('Credit card', '40000.00');

      const text = extractPdfText((await get('/api/reports/financial.pdf')).body);

      expect(text).toContain('Current net worth-39000.00');
    });

    it('renders an empty report instead of failing', async () => {
      const result = await get('/api/reports/financial.pdf');

      expect(result.status).toBe(200);
      const text = extractPdfText(result.body);
      expect(text).toContain('Total income0.00');
      expect(text).toContain('No income in the selected period.');
      expect(text).toContain('No wealth snapshots in the selected period.');
      expect(text).toContain('No savings goals yet.');
    });

    it('continues long lists across pages', async () => {
      for (let index = 0; index < 80; index += 1) {
        await createAsset(`Asset number ${index}`, '10.00', 'CASH');
      }

      const result = await get('/api/reports/financial.pdf');
      const pdf = (result.body as Buffer).toString('latin1');
      const pageCount = (pdf.match(/\/Type \/Page\b/g) ?? []).length;

      expect(result.status).toBe(200);
      expect(pageCount).toBeGreaterThan(1);
      expect(extractPdfText(result.body)).toContain('Asset number 79');
    });

    it('applies the same date range as the JSON report', async () => {
      await seedMixedData();

      const text = extractPdfText(
        (await get(`/api/reports/financial.pdf${rangeQuery(7)}`)).body
      );

      expect(text).toContain(`Report period${utcDaysAgo(7).slice(0, 10)} to ${utcDaysAgo(0).slice(0, 10)}`);
      expect(text).toContain('Total income0.00');
    });

    it('rejects anonymous requests and userId injection', async () => {
      const anonymous = await request(app).get('/api/reports/financial.pdf');
      const injected = await get(`/api/reports/financial.pdf?userId=${userB.id}`);

      expect(anonymous.status).toBe(401);
      expect(injected.status).toBe(400);
    });
  });

  describe('format consistency', () => {
    it('produces identical totals in JSON, CSV and PDF', async () => {
      await seedMixedData();

      const json = await report();
      const csv = (await get('/api/reports/financial.csv')).text;
      const pdfText = extractPdfText((await get('/api/reports/financial.pdf')).body);

      const checks: [string, string][] = [
        ['Total income', json.overview.income.toFixed(2)],
        ['Total expenses', json.overview.expenses.toFixed(2)],
        ['Net cash flow', json.overview.netCashFlow.toFixed(2)],
        ['Current total assets', json.overview.totalAssets.toFixed(2)],
        ['Current total liabilities', json.overview.totalLiabilities.toFixed(2)],
        ['Current net worth', json.overview.netWorth.toFixed(2)],
        ['Total goal target', json.overview.totalGoalTarget.toFixed(2)],
        ['Total goal saved', json.overview.totalGoalSaved.toFixed(2)],
      ];

      for (const [label, value] of checks) {
        expect(csv).toContain(`${label},${value}`);
        expect(pdfText).toContain(`${label}${value}`);
      }
    });

    it('renders the same period in every format', async () => {
      const query = rangeQuery(90);

      const json = await report(query);
      const csv = (await get(`/api/reports/financial.csv${query}`)).text;
      const pdfText = extractPdfText((await get(`/api/reports/financial.pdf${query}`)).body);

      expect(csv).toContain(`Period start,${utcDaysAgo(90).slice(0, 10)}`);
      expect(pdfText).toContain(
        `Report period${utcDaysAgo(90).slice(0, 10)} to ${utcDaysAgo(0).slice(0, 10)}`
      );
      expect(json.period.dateFrom).toBe(utcDaysAgo(90));
    });
  });
});
