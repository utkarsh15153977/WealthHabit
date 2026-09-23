import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, CategoryType, TransactionType } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import dashboardRoutes from '../src/routes/dashboardRoutes.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';
import { getDashboardSummaryData } from '../src/services/prismaDashboardService.js';

const mockedGetDashboardSummaryData = vi.mocked(getDashboardSummaryData);

vi.mock('../src/services/prismaDashboardService.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/services/prismaDashboardService.js')>();
  return {
    ...actual,
    getDashboardSummaryData: vi.fn(actual.getDashboardSummaryData),
  };
});

describe('Dashboard API', () => {
  let app: express.Express;
  let userA: { id: string };
  let userB: { id: string };
  let tokenA: string;
  let tokenB: string;
  let expenseFood: string;
  let expenseRent: string;
  let expenseOther: string;
  let incomeSalary: string;
  let incomeBonus: string;
  let userBExpense: string;

  beforeEach(async () => {
    mockedGetDashboardSummaryData.mockClear();

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
    tokenA = authService.generateAccessToken({ id: createdA.id, role: createdA.role });
    tokenB = authService.generateAccessToken({ id: createdB.id, role: createdB.role });

    const food = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Food', type: CategoryType.EXPENSE, icon: 'food', color: '#f00' },
    });
    const rent = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Rent', type: CategoryType.EXPENSE, icon: 'home', color: '#0f0' },
    });
    const other = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Other', type: CategoryType.EXPENSE },
    });
    const salary = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Salary', type: CategoryType.INCOME, icon: 'pay', color: '#00f' },
    });
    const bonus = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Bonus', type: CategoryType.INCOME },
    });
    const bExpense = await testPrisma.category.create({
      data: { userId: createdB.id, name: 'B Food', type: CategoryType.EXPENSE },
    });

    expenseFood = food.id;
    expenseRent = rent.id;
    expenseOther = other.id;
    incomeSalary = salary.id;
    incomeBonus = bonus.id;
    userBExpense = bExpense.id;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/categories', categoryRoutes);
    app.use('/api/transactions', transactionRoutes);
    app.use('/api/dashboard', dashboardRoutes);
    app.use(errorHandler);
  });

  async function seedTx(
    token: string,
    categoryId: string,
    type: TransactionType,
    amount: string,
    transactionDate: string
  ) {
    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId, type, amount, transactionDate });
    if (res.status !== 201) {
      throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.data.transaction.id as string;
  }

  function summary(token?: string, query = '') {
    const req = request(app).get(`/api/dashboard/summary${query}`);
    if (token) {
      req.set('Authorization', `Bearer ${token}`);
    }
    return req;
  }

  // --- Authentication ---

  it('returns 401 without authentication', async () => {
    const res = await summary(undefined, '?month=2026-01');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 with invalid token', async () => {
    const res = await summary('not-a-real-token', '?month=2026-01');
    expect(res.status).toBe(401);
  });

  // --- Empty state ---

  it('returns zero aggregates and empty arrays when user has no data', async () => {
    const res = await summary(tokenA, '?month=2026-01&recentLimit=5&categoryLimit=8&trendMonths=3');
    expect(res.status).toBe(200);
    const data = res.body.data;

    expect(data.period.month).toBe('2026-01');
    expect(data.period.start).toBe('2026-01-01T00:00:00.000Z');
    expect(data.period.end).toBe('2026-02-01T00:00:00.000Z');
    expect(data.period.timezone).toBe('UTC');
    expect(data.currency).toBe('USD');
    expect(data.summary).toEqual({
      income: 0,
      expenses: 0,
      savings: 0,
      savingsRate: 0,
    });
    expect(data.monthlySummary.income).toBe(0);
    expect(data.monthlySummary.expenses).toBe(0);
    expect(data.monthlySummary.savings).toBe(0);
    expect(data.monthlySummary.transactionCount).toBe(0);
    expect(data.monthlySummary.incomeTarget).toBeNull();
    expect(data.monthlySummary.savingsTarget).toBeNull();
    expect(data.targets).toEqual({
      monthlyIncomeTarget: null,
      monthlySavingsTarget: null,
    });
    expect(data.recentTransactions).toEqual([]);
    expect(data.spendingByCategory).toEqual([]);
    expect(data.incomeExpenseTrend).toHaveLength(3);
    expect(data.incomeExpenseTrend.every((p: any) => p.income === 0 && p.expenses === 0)).toBe(true);
    expect(data.recentTransactions).not.toBeNull();
    expect(data.spendingByCategory).not.toBeNull();
  });

  // --- Calculation scenarios ---

  it('calculates income, expenses, savings, and savings rate correctly', async () => {
    await seedTx(tokenA, incomeSalary, TransactionType.INCOME, '5000.00', '2026-01-10T12:00:00.000Z');
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '1500.25', '2026-01-15T12:00:00.000Z');
    await seedTx(tokenA, expenseRent, TransactionType.EXPENSE, '500.00', '2026-01-20T12:00:00.000Z');

    const res = await summary(tokenA, '?month=2026-01');
    expect(res.status).toBe(200);
    const { summary: s, monthlySummary } = res.body.data;

    expect(s.income).toBe(5000);
    expect(s.expenses).toBe(2000.25);
    expect(s.savings).toBe(2999.75);
    expect(s.savingsRate).toBe(60); // 2999.75 / 5000 * 100 = 59.995 → 2dp
    expect(monthlySummary.income).toBe(5000);
    expect(monthlySummary.expenses).toBe(2000.25);
    expect(monthlySummary.savings).toBe(2999.75);
    expect(monthlySummary.transactionCount).toBe(3);
    expect(monthlySummary.month).toBe('2026-01');
  });

  it('returns savingsRate 0 when income is 0 even with expenses', async () => {
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '100.00', '2026-01-15T12:00:00.000Z');

    const res = await summary(tokenA, '?month=2026-01');
    expect(res.status).toBe(200);
    const s = res.body.data.summary;
    expect(s.income).toBe(0);
    expect(s.expenses).toBe(100);
    expect(s.savings).toBe(-100);
    expect(s.savingsRate).toBe(0);
  });

  it('allows negative savings and does not clamp', async () => {
    await seedTx(tokenA, incomeSalary, TransactionType.INCOME, '100.00', '2026-01-05T12:00:00.000Z');
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '350.50', '2026-01-10T12:00:00.000Z');

    const res = await summary(tokenA, '?month=2026-01');
    expect(res.status).toBe(200);
    const s = res.body.data.summary;
    expect(s.savings).toBe(-250.5);
    expect(s.savingsRate).toBe(-250.5);
  });

  it('computes savings rate with 2 decimal places', async () => {
    await seedTx(tokenA, incomeSalary, TransactionType.INCOME, '300.00', '2026-01-01T12:00:00.000Z');
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '100.00', '2026-01-02T12:00:00.000Z');

    const res = await summary(tokenA, '?month=2026-01');
    expect(res.body.data.summary.savingsRate).toBe(66.67);
  });

  // --- Boundary tests (UTC half-open) ---

  it('includes transactions on first day of month', async () => {
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '10.00', '2026-01-01T00:00:00.000Z');
    const res = await summary(tokenA, '?month=2026-01');
    expect(res.body.data.summary.expenses).toBe(10);
    expect(res.body.data.monthlySummary.transactionCount).toBe(1);
  });

  it('excludes transactions on last microsecond of previous month / includes only [start,end)', async () => {
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '99.00', '2025-12-31T23:59:59.999Z');
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '5.00', '2026-02-01T00:00:00.000Z');
    const res = await summary(tokenA, '?month=2026-01');
    expect(res.body.data.summary.expenses).toBe(0);
    expect(res.body.data.monthlySummary.transactionCount).toBe(0);
  });

  it('excludes transaction exactly at period end (end exclusive)', async () => {
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '42.00', '2026-02-01T00:00:00.000Z');
    const res = await summary(tokenA, '?month=2026-01');
    expect(res.body.data.summary.expenses).toBe(0);
  });

  it('uses transactionDate not createdAt for month filtering', async () => {
    const id = await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '77.00', '2026-03-15T12:00:00.000Z');
    // createdAt is now (2026-09), but transactionDate is March 2026
    const resJan = await summary(tokenA, '?month=2026-01');
    expect(resJan.body.data.summary.expenses).toBe(0);
    const resMar = await summary(tokenA, '?month=2026-03');
    expect(resMar.body.data.summary.expenses).toBe(77);
    expect(resMar.body.data.monthlySummary.transactionCount).toBe(1);
    void id;
  });

  // --- Trend ---

  it('returns zero-filled chronological trend including selected month', async () => {
    await seedTx(tokenA, incomeSalary, TransactionType.INCOME, '1000.00', '2025-12-10T12:00:00.000Z');
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '200.00', '2026-01-10T12:00:00.000Z');

    const res = await summary(tokenA, '?month=2026-01&trendMonths=4');
    expect(res.status).toBe(200);
    const trend = res.body.data.incomeExpenseTrend;

    expect(trend).toHaveLength(4);
    expect(trend.map((p: any) => p.month)).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
    expect(trend[0]).toEqual({ month: '2025-10', income: 0, expenses: 0 });
    expect(trend[1]).toEqual({ month: '2025-11', income: 0, expenses: 0 });
    expect(trend[2]).toEqual({ month: '2025-12', income: 1000, expenses: 0 });
    expect(trend[3]).toEqual({ month: '2026-01', income: 0, expenses: 200 });
  });

  it('defaults trendMonths to 6 ending at selected month', async () => {
    const res = await summary(tokenA, '?month=2026-03');
    const trend = res.body.data.incomeExpenseTrend;
    expect(trend.map((p: any) => p.month)).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });

  it('supports trendMonths=1 (selected month only)', async () => {
    const res = await summary(tokenA, '?month=2026-03&trendMonths=1');
    expect(res.body.data.incomeExpenseTrend).toHaveLength(1);
    expect(res.body.data.incomeExpenseTrend[0].month).toBe('2026-03');
  });

  it('crosses year boundary in trend months', async () => {
    const res = await summary(tokenA, '?month=2026-02&trendMonths=3');
    expect(res.body.data.incomeExpenseTrend.map((p: any) => p.month)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  // --- Recent transactions ---

  it('returns recent transactions not scoped to month, newest first', async () => {
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '10.00', '2025-06-01T12:00:00.000Z');
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '20.00', '2026-01-15T12:00:00.000Z');
    await seedTx(tokenA, incomeSalary, TransactionType.INCOME, '30.00', '2026-01-20T12:00:00.000Z');
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '40.00', '2024-01-01T12:00:00.000Z');

    const res = await summary(tokenA, '?month=2026-01&recentLimit=3');
    expect(res.status).toBe(200);
    const recent = res.body.data.recentTransactions;

    expect(recent).toHaveLength(3);
    expect(recent[0].amount).toBe(30);
    expect(recent[1].amount).toBe(20);
    expect(recent[2].amount).toBe(10);
    // includes non-January transaction (2025-06-01 amount 10) — proves not month-scoped
    expect(recent.map((t: any) => t.amount)).not.toContain(40);
    expect(recent[0].category).toBeDefined();
    expect(recent[0].category.name).toBe('Salary');
    expect(recent[0]).toHaveProperty('transactionDate');
    expect(recent[0]).toHaveProperty('type');
    expect(recent[0]).toHaveProperty('categoryId');
  });

  it('defaults recentLimit to 5 and respects recentLimit bounds', async () => {
    for (let i = 1; i <= 7; i++) {
      await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, `${i}.00`, `2026-01-${String(i).padStart(2, '0')}T12:00:00.000Z`);
    }

    const def = await summary(tokenA, '?month=2026-01');
    expect(def.body.data.recentTransactions).toHaveLength(5);

    const limited = await summary(tokenA, '?month=2026-01&recentLimit=2');
    expect(limited.body.data.recentTransactions).toHaveLength(2);
    expect(limited.body.data.recentTransactions[0].amount).toBe(7);
    expect(limited.body.data.recentTransactions[1].amount).toBe(6);
  });

  // --- Spending by category ---

  it('aggregates only EXPENSE categories, sorted by amount desc with categoryId tie-break', async () => {
    await seedTx(tokenA, incomeSalary, TransactionType.INCOME, '5000.00', '2026-01-10T12:00:00.000Z');
    await seedTx(tokenA, expenseRent, TransactionType.EXPENSE, '1200.00', '2026-01-05T12:00:00.000Z');
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '300.50', '2026-01-06T12:00:00.000Z');
    await seedTx(tokenA, expenseOther, TransactionType.EXPENSE, '50.00', '2026-01-07T12:00:00.000Z');
    await seedTx(tokenA, incomeBonus, TransactionType.INCOME, '100.00', '2026-01-08T12:00:00.000Z');

    const res = await summary(tokenA, '?month=2026-01');
    expect(res.status).toBe(200);
    const cats = res.body.data.spendingByCategory;

    expect(cats).toHaveLength(3);
    // no INCOME categories
    expect(cats.every((c: any) => c.type === 'EXPENSE')).toBe(true);

    expect(cats[0].name).toBe('Rent');
    expect(cats[0].amount).toBe(1200);
    expect(cats[0].percentage).toBe(77.39); // 1200 / 1550.5 * 100
    expect(cats[0].categoryId).toBe(expenseRent);
    expect(cats[0].icon).toBe('home');
    expect(cats[0].color).toBe('#0f0');
    expect(cats[0].isDefault).toBe(false);

    expect(cats[1].name).toBe('Food');
    expect(cats[1].amount).toBe(300.5);
    expect(cats[1].percentage).toBe(19.38); // 300.5 / 1550.5 * 100

    expect(cats[2].name).toBe('Other');
    expect(cats[2].amount).toBe(50);
    expect(cats[2].percentage).toBe(3.22); // 50 / 1550.5 * 100
  });

  it('defaults categoryLimit to 8 and respects categoryLimit', async () => {
    const catIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const c = await testPrisma.category.create({
        data: { userId: userA.id, name: `Cat${String(i).padStart(2, '0')}`, type: CategoryType.EXPENSE },
      });
      catIds.push(c.id);
      await seedTx(tokenA, c.id, TransactionType.EXPENSE, `${(10 - i)}.00`, '2026-01-10T12:00:00.000Z');
    }

    const def = await summary(tokenA, '?month=2026-01');
    expect(def.body.data.spendingByCategory).toHaveLength(8);

    const limited = await summary(tokenA, '?month=2026-01&categoryLimit=3');
    expect(limited.body.data.spendingByCategory).toHaveLength(3);
    expect(limited.body.data.spendingByCategory[0].amount).toBe(10);
    expect(limited.body.data.spendingByCategory[2].amount).toBe(8);
  });

  it('returns empty spendingByCategory when no expenses in month', async () => {
    await seedTx(tokenA, incomeSalary, TransactionType.INCOME, '1000.00', '2026-01-10T12:00:00.000Z');
    const res = await summary(tokenA, '?month=2026-01');
    expect(res.body.data.spendingByCategory).toEqual([]);
  });

  it('does not rebalance percentages when truncated by categoryLimit', async () => {
    const c1 = await testPrisma.category.create({
      data: { userId: userA.id, name: 'Big', type: CategoryType.EXPENSE },
    });
    const c2 = await testPrisma.category.create({
      data: { userId: userA.id, name: 'Mid', type: CategoryType.EXPENSE },
    });
    const c3 = await testPrisma.category.create({
      data: { userId: userA.id, name: 'Small', type: CategoryType.EXPENSE },
    });
    await seedTx(tokenA, c1.id, TransactionType.EXPENSE, '50.00', '2026-01-10T12:00:00.000Z');
    await seedTx(tokenA, c2.id, TransactionType.EXPENSE, '30.00', '2026-01-11T12:00:00.000Z');
    await seedTx(tokenA, c3.id, TransactionType.EXPENSE, '20.00', '2026-01-12T12:00:00.000Z');

    const res = await summary(tokenA, '?month=2026-01&categoryLimit=1');
    const cats = res.body.data.spendingByCategory;
    expect(cats).toHaveLength(1);
    // 50/100 = 50%, not rebalanced to 100%
    expect(cats[0].percentage).toBe(50);
    void expenseOther;
  });

  it('does not leak another user category metadata into spendingByCategory', async () => {
    // Inconsistent DB row: user A transaction references user B's private category
    await testPrisma.transaction.create({
      data: {
        userId: userA.id,
        categoryId: userBExpense,
        type: TransactionType.EXPENSE,
        amount: '500.00',
        transactionDate: new Date('2026-01-10T12:00:00.000Z'),
      },
    });
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '100.00', '2026-01-11T12:00:00.000Z');

    const res = await summary(tokenA, '?month=2026-01');
    expect(res.status).toBe(200);

    const data = res.body.data;
    const cats = data.spendingByCategory;

    // Aggregate still counts the transaction amount
    expect(data.summary.expenses).toBe(600);

    // Foreign private category metadata must not appear
    expect(cats.every((c: any) => c.categoryId !== userBExpense)).toBe(true);
    expect(cats.every((c: any) => c.name !== 'B Food')).toBe(true);
    expect(cats).toHaveLength(1);
    expect(cats[0].categoryId).toBe(expenseFood);
    expect(cats[0].name).toBe('Food');
    expect(cats[0].amount).toBe(100);
  });

  it('includes system category metadata (userId null) in spendingByCategory', async () => {
    const systemCat = await testPrisma.category.create({
      data: { userId: null, name: 'System Transit', type: CategoryType.EXPENSE, isDefault: true },
    });
    await seedTx(tokenA, systemCat.id, TransactionType.EXPENSE, '75.00', '2026-01-10T12:00:00.000Z');

    const res = await summary(tokenA, '?month=2026-01');
    expect(res.status).toBe(200);
    const cats = res.body.data.spendingByCategory;
    expect(cats).toHaveLength(1);
    expect(cats[0].categoryId).toBe(systemCat.id);
    expect(cats[0].name).toBe('System Transit');
    expect(cats[0].isDefault).toBe(true);
  });

  // --- Cross-user isolation ---

  it('does not include another user data in summary aggregates', async () => {
    await seedTx(tokenA, incomeSalary, TransactionType.INCOME, '1000.00', '2026-01-10T12:00:00.000Z');
    await seedTx(tokenB, userBExpense, TransactionType.EXPENSE, '9999.00', '2026-01-15T12:00:00.000Z');

    const resA = await summary(tokenA, '?month=2026-01');
    expect(resA.body.data.summary.income).toBe(1000);
    expect(resA.body.data.summary.expenses).toBe(0);
    expect(resA.body.data.spendingByCategory).toEqual([]);
    expect(resA.body.data.recentTransactions.every((t: any) => t.amount !== 9999)).toBe(true);

    const resB = await summary(tokenB, '?month=2026-01');
    expect(resB.body.data.summary.income).toBe(0);
    expect(resB.body.data.summary.expenses).toBe(9999);
    expect(resB.body.data.recentTransactions).toHaveLength(1);
    expect(resB.body.data.spendingByCategory[0].name).toBe('B Food');
  });

  it('does not leak another user financial profile targets', async () => {
    await testPrisma.financialProfile.create({
      data: {
        userId: userB.id,
        currency: 'EUR',
        monthlyIncomeTarget: '9000.00',
        monthlySavingsTarget: '3000.00',
      },
    });

    const res = await summary(tokenA, '?month=2026-01');
    expect(res.body.data.currency).toBe('USD');
    expect(res.body.data.targets).toEqual({
      monthlyIncomeTarget: null,
      monthlySavingsTarget: null,
    });
  });

  // --- Profile / currency / targets ---

  it('returns profile currency and targets when profile exists', async () => {
    await testPrisma.financialProfile.create({
      data: {
        userId: userA.id,
        currency: 'EUR',
        monthlyIncomeTarget: '5000.00',
        monthlySavingsTarget: '1500.00',
      },
    });

    const res = await summary(tokenA, '?month=2026-01');
    expect(res.status).toBe(200);
    expect(res.body.data.currency).toBe('EUR');
    expect(res.body.data.targets).toEqual({
      monthlyIncomeTarget: 5000,
      monthlySavingsTarget: 1500,
    });
    expect(res.body.data.monthlySummary.incomeTarget).toBe(5000);
    expect(res.body.data.monthlySummary.savingsTarget).toBe(1500);
  });

  it('returns null targets when profile exists but targets are null', async () => {
    await testPrisma.financialProfile.create({
      data: { userId: userA.id, currency: 'GBP' },
    });

    const res = await summary(tokenA, '?month=2026-01');
    expect(res.body.data.currency).toBe('GBP');
    expect(res.body.data.targets.monthlyIncomeTarget).toBeNull();
    expect(res.body.data.targets.monthlySavingsTarget).toBeNull();
    expect(res.body.data.monthlySummary.incomeTarget).toBeNull();
    expect(res.body.data.monthlySummary.savingsTarget).toBeNull();
  });

  it('defaults currency to USD without profile', async () => {
    const res = await summary(tokenA, '?month=2026-01');
    expect(res.body.data.currency).toBe('USD');
  });

  // --- Default month (current UTC) ---

  it('defaults month to current UTC month', async () => {
    const now = new Date();
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const res = await summary(tokenA);
    expect(res.status).toBe(200);
    expect(res.body.data.period.month).toBe(expected);
    expect(res.body.data.monthlySummary.month).toBe(expected);
    expect(res.body.data.period.timezone).toBe('UTC');
  });

  // --- Validation ---

  it('rejects unknown query parameters with 400 VALIDATION_ERROR', async () => {
    const res = await summary(tokenA, '?month=2026-01&foo=bar');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid month format with 400', async () => {
    const res = await summary(tokenA, '?month=2026-13');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects non-YYYY-MM month with 400', async () => {
    const res = await summary(tokenA, '?month=January');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects trendMonths out of range with 400', async () => {
    const tooHigh = await summary(tokenA, '?month=2026-01&trendMonths=25');
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error.code).toBe('VALIDATION_ERROR');

    const zero = await summary(tokenA, '?month=2026-01&trendMonths=0');
    expect(zero.status).toBe(400);

    const negative = await summary(tokenA, '?month=2026-01&trendMonths=-1');
    expect(negative.status).toBe(400);
  });

  it('rejects recentLimit out of range with 400', async () => {
    const tooHigh = await summary(tokenA, '?month=2026-01&recentLimit=21');
    expect(tooHigh.status).toBe(400);

    const zero = await summary(tokenA, '?month=2026-01&recentLimit=0');
    expect(zero.status).toBe(400);
  });

  it('rejects categoryLimit out of range with 400', async () => {
    const tooHigh = await summary(tokenA, '?month=2026-01&categoryLimit=51');
    expect(tooHigh.status).toBe(400);

    const zero = await summary(tokenA, '?month=2026-01&categoryLimit=0');
    expect(zero.status).toBe(400);
  });

  it('accepts boundary limit values', async () => {
    const res = await summary(
      tokenA,
      '?month=2026-01&trendMonths=1&recentLimit=1&categoryLimit=1'
    );
    expect(res.status).toBe(200);

    const max = await summary(
      tokenA,
      '?month=2026-01&trendMonths=24&recentLimit=20&categoryLimit=50'
    );
    expect(max.status).toBe(200);
    expect(max.body.data.incomeExpenseTrend).toHaveLength(24);
  });

  // --- Response shape ---

  it('returns locked response shape with success envelope', async () => {
    const res = await summary(tokenA, '?month=2026-01');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;

    expect(Object.keys(data).sort()).toEqual(
      [
        'currency',
        'incomeExpenseTrend',
        'monthlySummary',
        'period',
        'recentTransactions',
        'spendingByCategory',
        'summary',
        'targets',
      ].sort()
    );
    expect(Object.keys(data.period).sort()).toEqual(
      ['end', 'month', 'start', 'timezone'].sort()
    );
    expect(Object.keys(data.summary).sort()).toEqual(
      ['expenses', 'income', 'savings', 'savingsRate'].sort()
    );
    expect(Object.keys(data.monthlySummary).sort()).toEqual(
      [
        'expenses',
        'income',
        'incomeTarget',
        'month',
        'savings',
        'savingsTarget',
        'transactionCount',
      ].sort()
    );
    expect(Object.keys(data.targets).sort()).toEqual(
      ['monthlyIncomeTarget', 'monthlySavingsTarget'].sort()
    );
    expect(typeof data.period.start).toBe('string');
    expect(typeof data.period.end).toBe('string');
    expect(data.period.timezone).toBe('UTC');
    expect(Array.isArray(data.recentTransactions)).toBe(true);
    expect(Array.isArray(data.incomeExpenseTrend)).toBe(true);
    expect(Array.isArray(data.spendingByCategory)).toBe(true);
  });

  it('returns amounts as numbers not strings', async () => {
    await seedTx(tokenA, incomeSalary, TransactionType.INCOME, '1234.56', '2026-01-10T12:00:00.000Z');
    const res = await summary(tokenA, '?month=2026-01');
    expect(typeof res.body.data.summary.income).toBe('number');
    expect(res.body.data.summary.income).toBe(1234.56);
    expect(typeof res.body.data.recentTransactions[0].amount).toBe('number');
  });

  // --- Isolation: recent includes only own across all months ---

  it('recent ordering uses transactionDate desc then createdAt then id', async () => {
    const d = '2026-01-15T00:00:00.000Z';
    const id1 = await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '1.00', d);
    const id2 = await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '2.00', d);

    const res = await summary(tokenA, '?month=2026-01&recentLimit=10');
    const ids = res.body.data.recentTransactions.map((t: any) => t.id);
    // Same transactionDate: later createdAt (and id) first
    expect(ids[0]).toBe(id2);
    expect(ids[1]).toBe(id1);
  });

  it('does not return another user recent transactions', async () => {
    await seedTx(tokenA, expenseFood, TransactionType.EXPENSE, '11.00', '2026-01-15T12:00:00.000Z');
    await seedTx(tokenB, userBExpense, TransactionType.EXPENSE, '22.00', '2026-01-16T12:00:00.000Z');

    const res = await summary(tokenA, '?month=2026-01&recentLimit=20');
    expect(res.body.data.recentTransactions).toHaveLength(1);
    expect(res.body.data.recentTransactions[0].amount).toBe(11);
  });

  // --- 500 error ---

  it('returns generic 500 on unexpected service failure', async () => {
    mockedGetDashboardSummaryData.mockRejectedValueOnce(new Error('db exploded'));

    const res = await summary(tokenA, '?month=2026-01');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
