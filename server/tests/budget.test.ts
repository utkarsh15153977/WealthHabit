import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import {
  Prisma,
  Role,
  AccountStatus,
  CategoryType,
  TransactionType,
} from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';
import budgetRoutes from '../src/routes/budgetRoutes.js';

describe('Budgets API', () => {
  let app: express.Express;
  let userA: { id: string };
  let userB: { id: string };
  let tokenA: string;
  let tokenB: string;
  let foodCatA: string;
  let transportCatA: string;
  let salaryCatA: string;
  let systemExpenseCat: string;
  let foodCatB: string;

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
    tokenA = authService.generateAccessToken({ id: createdA.id, role: createdA.role });
    tokenB = authService.generateAccessToken({ id: createdB.id, role: createdB.role });

    const food = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Food', type: CategoryType.EXPENSE },
    });
    const transport = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Transport', type: CategoryType.EXPENSE },
    });
    const salary = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Salary', type: CategoryType.INCOME },
    });
    const system = await testPrisma.category.create({
      data: { userId: null, name: 'System Food', type: CategoryType.EXPENSE, isDefault: true },
    });
    const foodB = await testPrisma.category.create({
      data: { userId: createdB.id, name: 'B Food', type: CategoryType.EXPENSE },
    });

    foodCatA = food.id;
    transportCatA = transport.id;
    salaryCatA = salary.id;
    systemExpenseCat = system.id;
    foodCatB = foodB.id;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/categories', categoryRoutes);
    app.use('/api/transactions', transactionRoutes);
    app.use('/api/budgets', budgetRoutes);
    app.use(errorHandler);
  });

  function createBudget(token: string, body: Record<string, unknown>) {
    return request(app).post('/api/budgets').set('Authorization', `Bearer ${token}`).send(body);
  }

  async function seedBudget(token: string, body: Record<string, unknown>): Promise<string> {
    const res = await createBudget(token, body);
    expect(res.status).toBe(201);
    return res.body.data.budget.id;
  }

  async function seedTx(
    userId: string,
    categoryId: string,
    type: TransactionType,
    amount: string,
    date: string
  ): Promise<void> {
    await testPrisma.transaction.create({
      data: {
        userId,
        categoryId,
        type,
        amount,
        transactionDate: new Date(date),
      },
    });
  }

  function getProgress(token: string, id: string) {
    return request(app)
      .get(`/api/budgets/${id}/progress`)
      .set('Authorization', `Bearer ${token}`);
  }

  // --- Authentication & creation ---

  it('rejects unauthenticated create', async () => {
    const res = await request(app)
      .post('/api/budgets')
      .send({ name: 'Food', amount: '100.00', month: '2026-09' });

    expect(res.status).toBe(401);
  });

  it('creates a budget without category', async () => {
    const res = await createBudget(tokenA, {
      name: 'Monthly essentials',
      amount: '500.00',
      month: '2026-09',
    });

    expect(res.status).toBe(201);
    const budget = res.body.data.budget;
    expect(budget.userId).toBe(userA.id);
    expect(budget.name).toBe('Monthly essentials');
    expect(budget.amount).toBe(500);
    expect(budget.month).toBe('2026-09');
    expect(budget.category).toBeNull();

    const stored = await testPrisma.budget.findUnique({ where: { id: budget.id } });
    expect(stored?.month.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('creates a category budget with allocation', async () => {
    const res = await createBudget(tokenA, {
      name: 'Groceries',
      amount: '300.00',
      month: '2026-09',
      categoryId: foodCatA,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.budget.category).toMatchObject({
      id: foodCatA,
      name: 'Food',
      type: 'EXPENSE',
    });

    const allocations = await testPrisma.budgetCategory.findMany({
      where: { budgetId: res.body.data.budget.id },
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0].categoryId).toBe(foodCatA);
    expect(allocations[0].allocatedAmount.toNumber()).toBe(300);
  });

  it('creates a budget with a system (default) category', async () => {
    const res = await createBudget(tokenA, {
      name: 'System category budget',
      amount: '150',
      month: '2026-09',
      categoryId: systemExpenseCat,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.budget.category.id).toBe(systemExpenseCat);
    expect(res.body.data.budget.category.isDefault).toBe(true);
  });

  it('rejects duplicate budget name for the same month', async () => {
    const first = await createBudget(tokenA, {
      name: 'Food',
      amount: '100',
      month: '2026-09',
    });
    expect(first.status).toBe(201);

    const second = await createBudget(tokenA, {
      name: 'Food',
      amount: '200',
      month: '2026-09',
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('BUDGET_ALREADY_EXISTS');
  });

  it('allows the same budget name in a different month', async () => {
    const first = await createBudget(tokenA, { name: 'Food', amount: '100', month: '2026-09' });
    const second = await createBudget(tokenA, { name: 'Food', amount: '100', month: '2026-10' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it('allows the same budget name for a different user', async () => {
    const a = await createBudget(tokenA, { name: 'Food', amount: '100', month: '2026-09' });
    const b = await createBudget(tokenB, { name: 'Food', amount: '100', month: '2026-09' });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.data.budget.userId).toBe(userB.id);
  });

  // --- List & get ---

  it('lists only own budgets with progress', async () => {
    await seedBudget(tokenA, { name: 'A Sept', amount: '100', month: '2026-09' });
    await seedBudget(tokenA, { name: 'A Aug', amount: '200', month: '2026-08' });
    await seedBudget(tokenB, { name: 'B Sept', amount: '300', month: '2026-09' });

    const res = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const budgets = res.body.data.budgets;
    expect(budgets).toHaveLength(2);
    expect(budgets.map((b: { name: string }) => b.name).sort()).toEqual(['A Aug', 'A Sept']);
    expect(budgets.every((b: { userId: string }) => b.userId === userA.id)).toBe(true);
    expect(budgets[0].progress).toMatchObject({
      budgetAmount: expect.any(Number),
      spent: expect.any(Number),
      remaining: expect.any(Number),
      percentageUsed: expect.any(Number),
      transactionCount: expect.any(Number),
      periodStart: expect.any(String),
      periodEnd: expect.any(String),
    });
  });

  it('filters list by month', async () => {
    await seedBudget(tokenA, { name: 'Sept', amount: '100', month: '2026-09' });
    await seedBudget(tokenA, { name: 'Oct', amount: '100', month: '2026-10' });

    const res = await request(app)
      .get('/api/budgets?month=2026-09')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.budgets).toHaveLength(1);
    expect(res.body.data.budgets[0].name).toBe('Sept');
  });

  it('gets own budget with progress', async () => {
    const id = await seedBudget(tokenA, {
      name: 'Groceries',
      amount: '300',
      month: '2026-09',
      categoryId: foodCatA,
    });

    const res = await request(app)
      .get(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const budget = res.body.data.budget;
    expect(budget.id).toBe(id);
    expect(budget.name).toBe('Groceries');
    expect(budget.category.id).toBe(foodCatA);
    expect(budget.progress).toBeDefined();
    expect(budget.progress.periodStart).toBe('2026-09-01T00:00:00.000Z');
    expect(budget.progress.periodEnd).toBe('2026-10-01T00:00:00.000Z');
  });

  it('returns 404 when getting another user\'s budget', async () => {
    const id = await seedBudget(tokenB, { name: 'B budget', amount: '100', month: '2026-09' });

    const res = await request(app)
      .get(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BUDGET_NOT_FOUND');
  });

  // --- Update ---

  it('updates own budget name, amount and month', async () => {
    const id = await seedBudget(tokenA, { name: 'Old name', amount: '100', month: '2026-09' });

    const res = await request(app)
      .patch(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'New name', amount: '250.75', month: '2026-10' });

    expect(res.status).toBe(200);
    expect(res.body.data.budget).toMatchObject({
      id,
      name: 'New name',
      amount: 250.75,
      month: '2026-10',
    });

    const stored = await testPrisma.budget.findUnique({ where: { id } });
    expect(stored?.name).toBe('New name');
    expect(stored?.month.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('sets and removes the budget category', async () => {
    const id = await seedBudget(tokenA, { name: 'Cat budget', amount: '100', month: '2026-09' });

    const set = await request(app)
      .patch(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ categoryId: foodCatA });
    expect(set.status).toBe(200);
    expect(set.body.data.budget.category.id).toBe(foodCatA);
    expect(
      await testPrisma.budgetCategory.count({ where: { budgetId: id } })
    ).toBe(1);

    const removed = await request(app)
      .patch(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ categoryId: null });
    expect(removed.status).toBe(200);
    expect(removed.body.data.budget.category).toBeNull();
    expect(
      await testPrisma.budgetCategory.count({ where: { budgetId: id } })
    ).toBe(0);
  });

  it('keeps allocation amount in sync when budget amount changes', async () => {
    const id = await seedBudget(tokenA, {
      name: 'Sync',
      amount: '100',
      month: '2026-09',
      categoryId: foodCatA,
    });

    const res = await request(app)
      .patch(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ amount: '400' });

    expect(res.status).toBe(200);
    const allocation = await testPrisma.budgetCategory.findFirst({ where: { budgetId: id } });
    expect(allocation?.allocatedAmount.toNumber()).toBe(400);
  });

  it('returns 404 when updating another user\'s budget', async () => {
    const id = await seedBudget(tokenB, { name: 'B budget', amount: '100', month: '2026-09' });

    const res = await request(app)
      .patch(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Hacked' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BUDGET_NOT_FOUND');
  });

  it('rejects update that collides with an existing budget name', async () => {
    await seedBudget(tokenA, { name: 'Existing', amount: '100', month: '2026-09' });
    const other = await seedBudget(tokenA, { name: 'Other', amount: '100', month: '2026-09' });

    const res = await request(app)
      .patch(`/api/budgets/${other}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Existing' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BUDGET_ALREADY_EXISTS');
  });

  // --- Delete ---

  it('deletes own budget and its allocations', async () => {
    const id = await seedBudget(tokenA, {
      name: 'Doomed',
      amount: '100',
      month: '2026-09',
      categoryId: foodCatA,
    });

    const res = await request(app)
      .delete(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe('Budget deleted');

    expect(await testPrisma.budget.findUnique({ where: { id } })).toBeNull();
    expect(
      await testPrisma.budgetCategory.count({ where: { budgetId: id } })
    ).toBe(0);

    const again = await request(app)
      .get(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(again.status).toBe(404);
  });

  it('returns 404 when deleting another user\'s budget', async () => {
    const id = await seedBudget(tokenB, { name: 'B budget', amount: '100', month: '2026-09' });

    const res = await request(app)
      .delete(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BUDGET_NOT_FOUND');
    expect(await testPrisma.budget.findUnique({ where: { id } })).not.toBeNull();
  });

  // --- Validation ---

  it('rejects missing name', async () => {
    const res = await createBudget(tokenA, { amount: '100', month: '2026-09' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors['body.name']).toBeDefined();
  });

  it('rejects invalid amounts', async () => {
    for (const amount of ['0', '-5', '10.123', 'abc']) {
      const res = await createBudget(tokenA, {
        name: 'Bad amount',
        amount,
        month: '2026-09',
      });
      expect(res.status).toBe(400);
      expect(res.body.errors['body.amount']).toBeDefined();
    }
  });

  it('rejects invalid month formats', async () => {
    for (const month of ['2026-13', 'September 2026', '2026-09-15', 'not-a-month']) {
      const res = await createBudget(tokenA, { name: 'Bad month', amount: '100', month });
      expect(res.status).toBe(400);
      expect(res.body.errors['body.month']).toBeDefined();
    }
  });

  it('rejects unknown fields', async () => {
    const res = await createBudget(tokenA, {
      name: 'Unknown fields',
      amount: '100',
      month: '2026-09',
      userId: userB.id,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects empty update body', async () => {
    const id = await seedBudget(tokenA, { name: 'Empty', amount: '100', month: '2026-09' });

    const res = await request(app)
      .patch(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an amount with more than two decimal places', async () => {
    const res = await createBudget(tokenA, {
      name: 'Precision',
      amount: '100.555',
      month: '2026-09',
    });

    expect(res.status).toBe(400);
    expect(res.body.errors['body.amount']).toBeDefined();
  });

  // --- Decimal amounts ---

  it('preserves decimal budget amounts', async () => {
    const res = await createBudget(tokenA, {
      name: 'Decimal',
      amount: '1234.56',
      month: '2026-09',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.budget.amount).toBe(1234.56);

    const stored = await testPrisma.budget.findUnique({
      where: { id: res.body.data.budget.id },
    });
    expect(stored?.amount.toFixed(2)).toBe('1234.56');
  });

  it('normalizes a whole-number amount to two decimals', async () => {
    const res = await createBudget(tokenA, { name: 'Whole', amount: 250, month: '2026-09' });

    expect(res.status).toBe(201);
    expect(res.body.data.budget.amount).toBe(250);

    const stored = await testPrisma.budget.findUnique({
      where: { id: res.body.data.budget.id },
    });
    expect(stored?.amount.toFixed(2)).toBe('250.00');
  });

  // --- Category validation ---

  it('rejects another user\'s category', async () => {
    const res = await createBudget(tokenA, {
      name: 'Stolen category',
      amount: '100',
      month: '2026-09',
      categoryId: foodCatB,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    expect(await testPrisma.budget.count()).toBe(0);
  });

  it('rejects an income category', async () => {
    const res = await createBudget(tokenA, {
      name: 'Income budget',
      amount: '100',
      month: '2026-09',
      categoryId: salaryCatA,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects updating budget to another user\'s category', async () => {
    const id = await seedBudget(tokenA, { name: 'Mine', amount: '100', month: '2026-09' });

    const res = await request(app)
      .patch(`/api/budgets/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ categoryId: foodCatB });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  // --- Progress ---

  it('reports zero spending for a budget with no transactions', async () => {
    const id = await seedBudget(tokenA, {
      name: 'No tx yet',
      amount: '100',
      month: '2026-09',
      categoryId: foodCatA,
    });

    const res = await getProgress(tokenA, id);

    expect(res.status).toBe(200);
    expect(res.body.data.progress).toEqual({
      budgetAmount: 100,
      spent: 0,
      remaining: 100,
      percentageUsed: 0,
      transactionCount: 0,
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      category: expect.objectContaining({ id: foodCatA, name: 'Food' }),
    });
  });

  it('reports spending below the budget', async () => {
    const id = await seedBudget(tokenA, {
      name: 'Below',
      amount: '100',
      month: '2026-09',
      categoryId: foodCatA,
    });
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '30.00', '2026-09-10T12:00:00.000Z');

    const res = await getProgress(tokenA, id);

    expect(res.body.data.progress).toMatchObject({
      budgetAmount: 100,
      spent: 30,
      remaining: 70,
      percentageUsed: 30,
      transactionCount: 1,
    });
  });

  it('reports spending exactly equal to the budget', async () => {
    const id = await seedBudget(tokenA, {
      name: 'Exact',
      amount: '100',
      month: '2026-09',
      categoryId: foodCatA,
    });
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '60.00', '2026-09-05T10:00:00.000Z');
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '40.00', '2026-09-20T10:00:00.000Z');

    const res = await getProgress(tokenA, id);

    expect(res.body.data.progress).toMatchObject({
      budgetAmount: 100,
      spent: 100,
      remaining: 0,
      percentageUsed: 100,
      transactionCount: 2,
    });
  });

  it('reports spending above the budget with negative remaining', async () => {
    const id = await seedBudget(tokenA, {
      name: 'Over',
      amount: '100',
      month: '2026-09',
      categoryId: foodCatA,
    });
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '150.00', '2026-09-10T12:00:00.000Z');

    const res = await getProgress(tokenA, id);

    expect(res.body.data.progress).toMatchObject({
      budgetAmount: 100,
      spent: 150,
      remaining: -50,
      percentageUsed: 150,
      transactionCount: 1,
    });
  });

  it('excludes income transactions from spending', async () => {
    const id = await seedBudget(tokenA, {
      name: 'Mixed',
      amount: '100',
      month: '2026-09',
      categoryId: foodCatA,
    });
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '25.00', '2026-09-10T12:00:00.000Z');
    await seedTx(userA.id, salaryCatA, TransactionType.INCOME, '5000.00', '2026-09-01T12:00:00.000Z');

    const res = await getProgress(tokenA, id);

    expect(res.body.data.progress).toMatchObject({
      spent: 25,
      transactionCount: 1,
      percentageUsed: 25,
    });
  });

  it('counts only the budget category transactions', async () => {
    const id = await seedBudget(tokenA, {
      name: 'Food only',
      amount: '100',
      month: '2026-09',
      categoryId: foodCatA,
    });
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '40.00', '2026-09-10T12:00:00.000Z');
    await seedTx(userA.id, transportCatA, TransactionType.EXPENSE, '60.00', '2026-09-11T12:00:00.000Z');

    const res = await getProgress(tokenA, id);

    expect(res.body.data.progress).toMatchObject({
      spent: 40,
      transactionCount: 1,
    });
  });

  it('counts all expense categories for a budget without category', async () => {
    const id = await seedBudget(tokenA, {
      name: 'Overall',
      amount: '500',
      month: '2026-09',
    });
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '40.00', '2026-09-10T12:00:00.000Z');
    await seedTx(userA.id, transportCatA, TransactionType.EXPENSE, '60.00', '2026-09-11T12:00:00.000Z');
    await seedTx(userA.id, salaryCatA, TransactionType.INCOME, '1000.00', '2026-09-01T12:00:00.000Z');

    const res = await getProgress(tokenA, id);

    expect(res.body.data.progress).toMatchObject({
      budgetAmount: 500,
      spent: 100,
      remaining: 400,
      percentageUsed: 20,
      transactionCount: 2,
    });
    expect(res.body.data.progress.category).toBeNull();
  });

  it('includes transactions across the full period boundaries', async () => {
    const id = await seedBudget(tokenA, {
      name: 'Boundaries',
      amount: '1000',
      month: '2026-09',
      categoryId: foodCatA,
    });

    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '1.00', '2026-09-01T00:00:00.000Z');
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '2.00', '2026-09-30T23:59:59.999Z');
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '100.00', '2026-08-31T23:59:00.000Z');
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '100.00', '2026-10-01T00:00:00.000Z');

    const res = await getProgress(tokenA, id);

    expect(res.body.data.progress).toMatchObject({
      spent: 3,
      transactionCount: 2,
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
    });
  });

  it('handles decimal amounts without floating point drift', async () => {
    const id = await seedBudget(tokenA, {
      name: 'Decimals',
      amount: '99.99',
      month: '2026-09',
      categoryId: foodCatA,
    });
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '10.10', '2026-09-01T00:00:00.000Z');
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '10.10', '2026-09-15T00:00:00.000Z');
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '10.10', '2026-09-30T00:00:00.000Z');

    const res = await getProgress(tokenA, id);

    expect(res.body.data.progress).toMatchObject({
      budgetAmount: 99.99,
      spent: 30.3,
      remaining: 69.69,
      percentageUsed: 30.3,
      transactionCount: 3,
    });
  });

  it('never counts another user\'s transactions', async () => {
    const id = await seedBudget(tokenA, {
      name: 'System budget',
      amount: '100',
      month: '2026-09',
      categoryId: systemExpenseCat,
    });

    await seedTx(userA.id, systemExpenseCat, TransactionType.EXPENSE, '10.00', '2026-09-05T12:00:00.000Z');
    await seedTx(userB.id, systemExpenseCat, TransactionType.EXPENSE, '90.00', '2026-09-06T12:00:00.000Z');

    const res = await getProgress(tokenA, id);

    expect(res.body.data.progress).toMatchObject({
      spent: 10,
      transactionCount: 1,
    });
  });

  it('returns 404 for another user\'s budget progress', async () => {
    const id = await seedBudget(tokenB, { name: 'B budget', amount: '100', month: '2026-09' });

    const res = await getProgress(tokenA, id);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BUDGET_NOT_FOUND');
  });

  // --- Multiple budgets & isolation ---

  it('keeps progress isolated across multiple budgets and users', async () => {
    const aFood = await seedBudget(tokenA, {
      name: 'A Food',
      amount: '200',
      month: '2026-09',
      categoryId: foodCatA,
    });
    const aTransport = await seedBudget(tokenA, {
      name: 'A Transport',
      amount: '100',
      month: '2026-09',
      categoryId: transportCatA,
    });
    const bFood = await seedBudget(tokenB, {
      name: 'B Food',
      amount: '100',
      month: '2026-09',
      categoryId: foodCatB,
    });

    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '50.00', '2026-09-10T12:00:00.000Z');
    await seedTx(userA.id, transportCatA, TransactionType.EXPENSE, '25.00', '2026-09-11T12:00:00.000Z');
    await seedTx(userB.id, foodCatB, TransactionType.EXPENSE, '80.00', '2026-09-12T12:00:00.000Z');

    const aFoodProgress = await getProgress(tokenA, aFood);
    const aTransportProgress = await getProgress(tokenA, aTransport);
    const bFoodProgress = await getProgress(tokenB, bFood);

    expect(aFoodProgress.body.data.progress).toMatchObject({ spent: 50, percentageUsed: 25 });
    expect(aTransportProgress.body.data.progress).toMatchObject({ spent: 25, percentageUsed: 25 });
    expect(bFoodProgress.body.data.progress).toMatchObject({ spent: 80, percentageUsed: 80 });

    const list = await request(app)
      .get('/api/budgets?month=2026-09')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(list.body.data.budgets).toHaveLength(2);
    expect(
      list.body.data.budgets.every((b: { userId: string }) => b.userId === userA.id)
    ).toBe(true);
  });

  // --- DB-001: list pagination ---

  function listBudgets(token: string, query = '') {
    return request(app)
      .get(`/api/budgets${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  it('paginates the budget list with correct totals and stable ordering', async () => {
    await seedBudget(tokenA, { name: 'Alpha', amount: '100', month: '2026-09' });
    await seedBudget(tokenA, { name: 'Beta', amount: '200', month: '2026-09' });
    await seedBudget(tokenA, { name: 'Gamma', amount: '300', month: '2026-09' });

    const firstPage = await listBudgets(tokenA, '?page=1&pageSize=2');
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.budgets).toHaveLength(2);
    expect(firstPage.body.data.page).toBe(1);
    expect(firstPage.body.data.pageSize).toBe(2);
    expect(firstPage.body.data.total).toBe(3);
    expect(firstPage.body.data.budgets.map((b: { name: string }) => b.name)).toEqual([
      'Gamma',
      'Beta',
    ]);

    const secondPage = await listBudgets(tokenA, '?page=2&pageSize=2');
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data.budgets).toHaveLength(1);
    expect(secondPage.body.data.page).toBe(2);
    expect(secondPage.body.data.pageSize).toBe(2);
    expect(secondPage.body.data.total).toBe(3);
    expect(secondPage.body.data.budgets[0].name).toBe('Alpha');

    const beyondLastPage = await listBudgets(tokenA, '?page=9&pageSize=2');
    expect(beyondLastPage.status).toBe(200);
    expect(beyondLastPage.body.data.budgets).toHaveLength(0);
    expect(beyondLastPage.body.data.total).toBe(3);
  });

  it('keeps month DESC, createdAt DESC, id DESC ordering across pages', async () => {
    await seedBudget(tokenA, { name: 'Aug Old', amount: '100', month: '2026-08' });
    await seedBudget(tokenA, { name: 'Sep First', amount: '100', month: '2026-09' });
    await seedBudget(tokenA, { name: 'Sep Second', amount: '100', month: '2026-09' });

    const all = await listBudgets(tokenA, '?pageSize=50');
    expect(all.body.data.budgets.map((b: { name: string }) => b.name)).toEqual([
      'Sep Second',
      'Sep First',
      'Aug Old',
    ]);

    const firstPage = await listBudgets(tokenA, '?pageSize=2');
    const secondPage = await listBudgets(tokenA, '?page=2&pageSize=2');
    expect(
      [...firstPage.body.data.budgets, ...secondPage.body.data.budgets].map(
        (b: { name: string }) => b.name
      )
    ).toEqual(['Sep Second', 'Sep First', 'Aug Old']);
  });

  it('applies default pagination when no query parameters are supplied', async () => {
    await seedBudget(tokenA, { name: 'Default One', amount: '100', month: '2026-09' });
    await seedBudget(tokenA, { name: 'Default Two', amount: '100', month: '2026-09' });

    const res = await listBudgets(tokenA);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.budgets)).toBe(true);
    expect(res.body.data.budgets).toHaveLength(2);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.pageSize).toBe(20);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.budgets[0].progress).toMatchObject({
      budgetAmount: 100,
      spent: 0,
      remaining: 100,
      percentageUsed: 0,
      transactionCount: 0,
    });
  });

  it('counts only the requested month in total when paginating by month', async () => {
    await seedBudget(tokenA, { name: 'Sep A', amount: '100', month: '2026-09' });
    await seedBudget(tokenA, { name: 'Sep B', amount: '100', month: '2026-09' });
    await seedBudget(tokenA, { name: 'Aug A', amount: '100', month: '2026-08' });
    await seedBudget(tokenA, { name: 'Jul A', amount: '100', month: '2026-07' });

    const res = await listBudgets(tokenA, '?month=2026-09&pageSize=1');

    expect(res.status).toBe(200);
    expect(res.body.data.budgets).toHaveLength(1);
    expect(res.body.data.budgets[0].month).toBe('2026-09');
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.pageSize).toBe(1);
    expect(res.body.data.total).toBe(2);
  });

  it('rejects invalid pagination query parameters', async () => {
    const zeroPage = await listBudgets(tokenA, '?page=0');
    expect(zeroPage.status).toBe(400);

    const oversized = await listBudgets(tokenA, '?pageSize=51');
    expect(oversized.status).toBe(400);

    const notNumericSize = await listBudgets(tokenA, '?pageSize=abc');
    expect(notNumericSize.status).toBe(400);

    const notNumericPage = await listBudgets(tokenA, '?page=abc');
    expect(notNumericPage.status).toBe(400);

    const zeroPageSize = await listBudgets(tokenA, '?pageSize=0');
    expect(zeroPageSize.status).toBe(400);

    const fractional = await listBudgets(tokenA, '?pageSize=1.5');
    expect(fractional.status).toBe(400);

    const unknown = await listBudgets(tokenA, '?unexpected=1');
    expect(unknown.status).toBe(400);
  });

  it('accepts the maximum page size boundary', async () => {
    const res = await listBudgets(tokenA, '?pageSize=50');

    expect(res.status).toBe(200);
    expect(res.body.data.pageSize).toBe(50);
  });

  // --- DB-001: list progress must match the dedicated progress endpoint ---

  it('returns list progress identical to the progress endpoint for every budget', async () => {
    const sepFood = await seedBudget(tokenA, {
      name: 'Sep Food',
      amount: '100',
      month: '2026-09',
      categoryId: foodCatA,
    });
    const sepTransport = await seedBudget(tokenA, {
      name: 'Sep Transport',
      amount: '500',
      month: '2026-09',
      categoryId: transportCatA,
    });
    const sepOverall = await seedBudget(tokenA, {
      name: 'Sep Overall',
      amount: '1000',
      month: '2026-09',
    });
    const sepMulti = await seedBudget(tokenA, {
      name: 'Sep Multi',
      amount: '1000',
      month: '2026-09',
      categoryId: foodCatA,
    });
    const sepSystem = await seedBudget(tokenA, {
      name: 'Sep System',
      amount: '200',
      month: '2026-09',
      categoryId: systemExpenseCat,
    });
    const augOverall = await seedBudget(tokenA, {
      name: 'Aug Overall',
      amount: '1000',
      month: '2026-08',
    });
    const augFood = await seedBudget(tokenA, {
      name: 'Aug Food',
      amount: '1000',
      month: '2026-08',
      categoryId: foodCatA,
    });

    await testPrisma.budgetCategory.create({
      data: {
        budgetId: sepMulti,
        categoryId: transportCatA,
        allocatedAmount: new Prisma.Decimal('1000'),
      },
    });

    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '150.00', '2026-09-05T10:00:00.000Z');
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '10.00', '2026-09-30T23:59:59.999Z');
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '999.00', '2026-10-01T00:00:00.000Z');
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '5.00', '2026-08-31T23:59:00.000Z');
    await seedTx(userA.id, transportCatA, TransactionType.EXPENSE, '50.00', '2026-09-11T08:00:00.000Z');
    await seedTx(userA.id, systemExpenseCat, TransactionType.EXPENSE, '75.25', '2026-09-12T08:00:00.000Z');
    await seedTx(userA.id, salaryCatA, TransactionType.INCOME, '5000.00', '2026-09-01T12:00:00.000Z');
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '200.00', '2026-08-15T08:00:00.000Z');
    await seedTx(userA.id, transportCatA, TransactionType.EXPENSE, '25.00', '2026-08-16T08:00:00.000Z');
    await seedTx(userA.id, salaryCatA, TransactionType.INCOME, '3000.00', '2026-08-01T12:00:00.000Z');
    await seedTx(userB.id, foodCatB, TransactionType.EXPENSE, '4000.00', '2026-09-20T08:00:00.000Z');

    const list = await listBudgets(tokenA, '?pageSize=50');
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(7);
    expect(list.body.data.budgets).toHaveLength(7);

    const listed = list.body.data.budgets as Array<{
      id: string;
      name: string;
      progress: Record<string, unknown>;
    }>;
    expect(listed.every((budget) => budget.progress !== undefined)).toBe(true);

    const budgetIds = [
      sepFood,
      sepTransport,
      sepOverall,
      sepMulti,
      sepSystem,
      augOverall,
      augFood,
    ];

    for (const id of budgetIds) {
      const progressRes = await getProgress(tokenA, id);
      expect(progressRes.status).toBe(200);

      const fromList = listed.find((budget) => budget.id === id);
      expect(fromList).toBeDefined();
      expect(fromList?.progress).toEqual(progressRes.body.data.progress);
    }

    const byName = new Map(listed.map((budget) => [budget.name, budget.progress]));

    expect(byName.get('Sep Food')).toMatchObject({
      budgetAmount: 100,
      spent: 160,
      remaining: -60,
      percentageUsed: 160,
      transactionCount: 2,
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
    });

    expect(byName.get('Sep Transport')).toMatchObject({
      spent: 50,
      remaining: 450,
      percentageUsed: 10,
      transactionCount: 1,
    });

    expect(byName.get('Sep Overall')).toMatchObject({
      budgetAmount: 1000,
      spent: 285.25,
      remaining: 714.75,
      percentageUsed: 28.53,
      transactionCount: 4,
    });
    expect(byName.get('Sep Overall')?.category).toBeNull();

    expect(byName.get('Sep Multi')).toMatchObject({
      budgetAmount: 1000,
      spent: 210,
      remaining: 790,
      percentageUsed: 21,
      transactionCount: 3,
    });
    expect([foodCatA, transportCatA]).toContain(byName.get('Sep Multi')?.category?.id);

    expect(byName.get('Sep System')).toMatchObject({
      budgetAmount: 200,
      spent: 75.25,
      remaining: 124.75,
      percentageUsed: 37.63,
      transactionCount: 1,
    });
    expect(byName.get('Sep System')?.category).toMatchObject({
      id: systemExpenseCat,
      isDefault: true,
    });

    expect(byName.get('Aug Overall')).toMatchObject({
      budgetAmount: 1000,
      spent: 230,
      remaining: 770,
      percentageUsed: 23,
      transactionCount: 3,
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
    });

    expect(byName.get('Aug Food')).toMatchObject({
      budgetAmount: 1000,
      spent: 205,
      remaining: 795,
      percentageUsed: 20.5,
      transactionCount: 2,
    });
  });

  it('keeps list progress consistent with the progress endpoint across pages', async () => {
    await seedBudget(tokenA, { name: 'Page One', amount: '100', month: '2026-10', categoryId: foodCatA });
    await seedBudget(tokenA, { name: 'Page Two', amount: '100', month: '2026-11', categoryId: transportCatA });
    await seedBudget(tokenA, { name: 'Page Three', amount: '100', month: '2026-12' });

    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '60.00', '2026-10-05T00:00:00.000Z');
    await seedTx(userA.id, transportCatA, TransactionType.EXPENSE, '30.00', '2026-11-05T00:00:00.000Z');
    await seedTx(userA.id, foodCatA, TransactionType.EXPENSE, '20.00', '2026-12-05T00:00:00.000Z');

    for (const page of [1, 2, 3]) {
      const list = await listBudgets(tokenA, `?page=${page}&pageSize=1`);
      expect(list.status).toBe(200);
      expect(list.body.data.total).toBe(3);
      expect(list.body.data.budgets).toHaveLength(1);

      const budget = list.body.data.budgets[0];
      const progressRes = await getProgress(tokenA, budget.id);
      expect(progressRes.status).toBe(200);
      expect(budget.progress).toEqual(progressRes.body.data.progress);
    }
  });
});
