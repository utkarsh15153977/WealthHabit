import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, CategoryType, TransactionType, Frequency } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';
import budgetRoutes from '../src/routes/budgetRoutes.js';
import dashboardRoutes from '../src/routes/dashboardRoutes.js';
import recurringTransactionRoutes from '../src/routes/recurringTransactionRoutes.js';
import { generateOccurrencesForRule } from '../src/services/prismaRecurringTransactionService.js';
import { startOfUtcDay, currentUtcMonth } from '../src/utils/date.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const today = startOfUtcDay(new Date());

function daysAgo(days: number): Date {
  return new Date(today.getTime() - days * MS_PER_DAY);
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rowDay(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

describe('Recurring Transactions API', () => {
  let app: express.Express;
  let userA: { id: string };
  let userB: { id: string };
  let tokenA: string;
  let tokenB: string;
  let foodCatA: string;
  let salaryCatA: string;
  let systemCat: string;
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

    const foodA = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Food', type: CategoryType.EXPENSE },
    });
    const salaryA = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Salary', type: CategoryType.INCOME },
    });
    const system = await testPrisma.category.create({
      data: { userId: null, name: 'System Food', type: CategoryType.EXPENSE, isDefault: true },
    });
    const foodB = await testPrisma.category.create({
      data: { userId: createdB.id, name: 'B Food', type: CategoryType.EXPENSE },
    });

    foodCatA = foodA.id;
    salaryCatA = salaryA.id;
    systemCat = system.id;
    foodCatB = foodB.id;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/categories', categoryRoutes);
    app.use('/api/transactions', transactionRoutes);
    app.use('/api/budgets', budgetRoutes);
    app.use('/api/recurring-transactions', recurringTransactionRoutes);
    app.use('/api/dashboard', dashboardRoutes);
    app.use(errorHandler);
  });

  function createRulePayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Groceries',
      categoryId: foodCatA,
      type: 'EXPENSE',
      amount: '100.00',
      frequency: 'MONTHLY',
      startDate: toIsoDay(today),
      ...overrides,
    };
  }

  async function createRule(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createRulePayload(overrides));

    expect(res.status).toBe(201);
    return res.body.data.recurringTransaction.id as string;
  }

  async function generate(ruleId: string, token: string = tokenA) {
    return request(app)
      .post(`/api/recurring-transactions/${ruleId}/generate`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function countTransactions(ruleId?: string): Promise<number> {
    return testPrisma.transaction.count({
      where: ruleId ? { recurringTransactionId: ruleId } : {},
    });
  }

  // ---------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------

  it('creates a recurring transaction with nextOccurrenceDate = startDate', async () => {
    const res = await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createRulePayload());

    expect(res.status).toBe(201);
    const rule = res.body.data.recurringTransaction;
    expect(rule.name).toBe('Groceries');
    expect(rule.amount).toBe(100);
    expect(rule.frequency).toBe('MONTHLY');
    expect(rule.isActive).toBe(true);
    expect(rule.category.id).toBe(foodCatA);
    expect(rowDay(new Date(rule.startDate))).toBe(rowDay(today));
    expect(rowDay(new Date(rule.nextOccurrenceDate))).toBe(rowDay(today));
    expect(rule.endDate).toBeNull();
  });

  it('creates a recurring transaction with a system (default) category', async () => {
    const res = await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createRulePayload({ categoryId: systemCat }));

    expect(res.status).toBe(201);
    expect(res.body.data.recurringTransaction.category.id).toBe(systemCat);
  });

  it('lists only own recurring transactions', async () => {
    await createRule({ name: 'A Rule' });

    await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        name: 'B Rule',
        categoryId: foodCatB,
        type: 'EXPENSE',
        amount: '50.00',
        frequency: 'WEEKLY',
        startDate: toIsoDay(today),
      })
      .expect(201);

    const res = await request(app)
      .get('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.recurringTransactions).toHaveLength(1);
    expect(res.body.data.recurringTransactions[0].name).toBe('A Rule');
  });

  it('filters the list by isActive', async () => {
    await createRule({ name: 'Active Rule' });
    await createRule({ name: 'Inactive Rule', isActive: false });

    const active = await request(app)
      .get('/api/recurring-transactions?isActive=true')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const inactive = await request(app)
      .get('/api/recurring-transactions?isActive=false')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(active.body.data.recurringTransactions).toHaveLength(1);
    expect(active.body.data.recurringTransactions[0].name).toBe('Active Rule');
    expect(inactive.body.data.recurringTransactions).toHaveLength(1);
    expect(inactive.body.data.recurringTransactions[0].name).toBe('Inactive Rule');
  });

  it('gets own recurring transaction', async () => {
    const id = await createRule();

    const res = await request(app)
      .get(`/api/recurring-transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.recurringTransaction.id).toBe(id);
    expect(res.body.data.recurringTransaction.category.name).toBe('Food');
  });

  it('updates own recurring transaction', async () => {
    const id = await createRule();

    const res = await request(app)
      .patch(`/api/recurring-transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Updated Rule', amount: '250.50', frequency: 'WEEKLY', isActive: false })
      .expect(200);

    const rule = res.body.data.recurringTransaction;
    expect(rule.name).toBe('Updated Rule');
    expect(rule.amount).toBe(250.5);
    expect(rule.frequency).toBe('WEEKLY');
    expect(rule.isActive).toBe(false);
  });

  it('deletes own recurring transaction', async () => {
    const id = await createRule();

    await request(app)
      .delete(`/api/recurring-transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    await request(app)
      .get(`/api/recurring-transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('rejects unauthenticated requests', async () => {
    await request(app)
      .post('/api/recurring-transactions')
      .send(createRulePayload())
      .expect(401);

    await request(app).get('/api/recurring-transactions').expect(401);
  });

  // ---------------------------------------------------------------
  // User isolation
  // --------------------------------------------------------------

  it('returns 404 when reading another user\'s recurring transaction', async () => {
    const id = await createRule();

    await request(app)
      .get(`/api/recurring-transactions/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('returns 404 when updating another user\'s recurring transaction', async () => {
    const id = await createRule();

    const res = await request(app)
      .patch(`/api/recurring-transactions/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Hacked' })
      .expect(404);

    expect(res.body.error.code).toBe('RECURRING_TRANSACTION_NOT_FOUND');
  });

  it('returns 404 when deleting another user\'s recurring transaction', async () => {
    const id = await createRule();

    await request(app)
      .delete(`/api/recurring-transactions/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    const stillExists = await testPrisma.recurringTransaction.findUnique({ where: { id } });
    expect(stillExists).not.toBeNull();
  });

  it('returns 404 when generating another user\'s occurrences', async () => {
    const id = await createRule({ startDate: toIsoDay(daysAgo(3)), frequency: 'DAILY' });

    const res = await generate(id, tokenB);
    expect(res.status).toBe(404);
    expect(await countTransactions(id)).toBe(0);
  });

  // ---------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------

  it('rejects an invalid frequency', async () => {
    const res = await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createRulePayload({ frequency: 'BIWEEKLY' }));

    expect(res.status).toBe(400);
    expect(res.body.errors['body.frequency']).toBeDefined();
  });

  it('rejects invalid amounts', async () => {
    for (const amount of ['-5', '10.999', 'abc', '0']) {
      const res = await request(app)
        .post('/api/recurring-transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(createRulePayload({ amount }));

      expect(res.status).toBe(400);
      expect(res.body.errors['body.amount']).toBeDefined();
    }
  });

  it('rejects invalid dates', async () => {
    const badDate = await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createRulePayload({ startDate: 'not-a-date' }));

    expect(badDate.status).toBe(400);
    expect(badDate.body.errors['body.startDate']).toBeDefined();

    const badRange = await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createRulePayload({ startDate: '2026-10-01', endDate: '2026-09-01' }));

    expect(badRange.status).toBe(400);
    expect(badRange.body.errors['body.endDate']).toBeDefined();
  });

  it('rejects unknown fields', async () => {
    const res = await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createRulePayload({ userId: userB.id }));

    expect(res.status).toBe(400);
  });

  it('rejects an empty update body', async () => {
    const id = await createRule();

    const res = await request(app)
      .patch(`/api/recurring-transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects another user\'s category', async () => {
    const res = await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createRulePayload({ categoryId: foodCatB }));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('rejects a category whose type does not match', async () => {
    const res = await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createRulePayload({ categoryId: salaryCatA, type: 'EXPENSE' }));

    expect(res.status).toBe(400);
    expect(res.body.errors['body.categoryId']).toBeDefined();
  });

  it('rejects updating to a category whose type does not match', async () => {
    const id = await createRule();

    const res = await request(app)
      .patch(`/api/recurring-transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: 'INCOME' });

    expect(res.status).toBe(400);
    expect(res.body.errors['body.type']).toBeDefined();
  });

  // ---------------------------------------------------------------
  // Generation
  // --------------------------------------------------------------

  it('generates the first occurrence', async () => {
    const id = await createRule({ startDate: toIsoDay(today), frequency: 'DAILY' });

    const res = await generate(id);
    expect(res.status).toBe(200);
    expect(res.body.data.occurrencesCreated).toBe(1);

    const rows = await testPrisma.transaction.findMany({
      where: { recurringTransactionId: id },
    });
    expect(rows).toHaveLength(1);
    expect(rowDay(rows[0].transactionDate)).toBe(rowDay(today));
    expect(rows[0].description).toBe('Groceries');
    expect(Number(rows[0].amount)).toBe(100);
    expect(rows[0].type).toBe(TransactionType.EXPENSE);
    expect(rows[0].userId).toBe(userA.id);
  });

  it('backfills multiple missed occurrences', async () => {
    const id = await createRule({ startDate: toIsoDay(daysAgo(3)), frequency: 'DAILY' });

    const res = await generate(id);
    expect(res.body.data.occurrencesCreated).toBe(4);
    expect(await countTransactions(id)).toBe(4);
  });

  it('is idempotent when generation runs twice', async () => {
    const id = await createRule({ startDate: toIsoDay(daysAgo(3)), frequency: 'DAILY' });

    const first = await generate(id);
    expect(first.body.data.occurrencesCreated).toBe(4);

    const second = await generate(id);
    expect(second.status).toBe(200);
    expect(second.body.data.occurrencesCreated).toBe(0);
    expect(await countTransactions(id)).toBe(4);

    const rows = await testPrisma.transaction.findMany({
      where: { recurringTransactionId: id },
      orderBy: { transactionDate: 'asc' },
    });
    const days = rows.map((row) => rowDay(row.transactionDate));
    expect(new Set(days).size).toBe(4);
  });

  it('never creates duplicates even when racing from a stale rule snapshot', async () => {
    const id = await createRule({ startDate: toIsoDay(daysAgo(5)), frequency: 'DAILY' });

    const staleRule = await testPrisma.recurringTransaction.findUnique({ where: { id } });
    expect(staleRule).not.toBeNull();

    const horizon = today;
    const run1 = await generateOccurrencesForRule(staleRule!, horizon);
    const run2 = await generateOccurrencesForRule(staleRule!, horizon);

    expect(run1.occurrencesCreated).toBe(6);
    expect(run2.occurrencesCreated).toBe(0);
    expect(await countTransactions(id)).toBe(6);
  });

  it('does not generate occurrences for an inactive recurrence', async () => {
    const id = await createRule({
      startDate: toIsoDay(daysAgo(3)),
      frequency: 'DAILY',
      isActive: false,
    });

    const res = await generate(id);
    expect(res.status).toBe(200);
    expect(res.body.data.occurrencesCreated).toBe(0);
    expect(await countTransactions(id)).toBe(0);
  });

  it('respects an inclusive end date', async () => {
    const id = await createRule({
      startDate: toIsoDay(daysAgo(3)),
      endDate: toIsoDay(daysAgo(1)),
      frequency: 'DAILY',
    });

    const res = await generate(id);
    expect(res.body.data.occurrencesCreated).toBe(3);
    expect(await countTransactions(id)).toBe(3);

    const rows = await testPrisma.transaction.findMany({
      where: { recurringTransactionId: id },
      orderBy: { transactionDate: 'asc' },
    });
    expect(rowDay(rows[rows.length - 1].transactionDate)).toBe(rowDay(daysAgo(1)));
  });

  it('generates daily recurrences', async () => {
    const id = await createRule({ startDate: toIsoDay(daysAgo(7)), frequency: 'DAILY' });

    const res = await generate(id);
    expect(res.body.data.occurrencesCreated).toBe(8);
    expect(res.body.data.nextOccurrenceDate).toBeTruthy();

    const rows = await testPrisma.transaction.findMany({
      where: { recurringTransactionId: id },
      orderBy: { transactionDate: 'asc' },
    });
    expect(rowDay(rows[0].transactionDate)).toBe(rowDay(daysAgo(7)));
    expect(rowDay(rows[7].transactionDate)).toBe(rowDay(today));
  });

  it('generates weekly recurrences', async () => {
    const id = await createRule({ startDate: toIsoDay(daysAgo(21)), frequency: 'WEEKLY' });

    const res = await generate(id);
    expect(res.body.data.occurrencesCreated).toBe(4);

    const rows = await testPrisma.transaction.findMany({
      where: { recurringTransactionId: id },
      orderBy: { transactionDate: 'asc' },
    });
    expect(rowDay(rows[0].transactionDate)).toBe(rowDay(daysAgo(21)));
    expect(rowDay(rows[3].transactionDate)).toBe(rowDay(today));
  });

  it('generates monthly recurrences', async () => {
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1)
    );
    const id = await createRule({ startDate: toIsoDay(start), frequency: 'MONTHLY' });

    const res = await generate(id);
    expect(res.body.data.occurrencesCreated).toBe(4);

    const firstOfCurrentMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
    );
    const rows = await testPrisma.transaction.findMany({
      where: { recurringTransactionId: id },
      orderBy: { transactionDate: 'asc' },
    });
    expect(rowDay(rows[0].transactionDate)).toBe(toIsoDay(start));
    expect(rowDay(rows[3].transactionDate)).toBe(toIsoDay(firstOfCurrentMonth));
  });

  it('generates yearly recurrences', async () => {
    const start = new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1));
    const id = await createRule({ startDate: toIsoDay(start), frequency: 'YEARLY' });

    const res = await generate(id);
    expect(res.body.data.occurrencesCreated).toBe(2);

    const rows = await testPrisma.transaction.findMany({
      where: { recurringTransactionId: id },
      orderBy: { transactionDate: 'asc' },
    });
    expect(rowDay(rows[0].transactionDate)).toBe(toIsoDay(start));
    expect(rowDay(rows[1].transactionDate)).toBe(
      `${today.getUTCFullYear()}-01-01`
    );
  });

  it('advances nextOccurrenceDate past the processing date', async () => {
    const id = await createRule({ startDate: toIsoDay(daysAgo(2)), frequency: 'DAILY' });

    const res = await generate(id);
    const nextOccurrence = new Date(res.body.data.nextOccurrenceDate);
    expect(rowDay(nextOccurrence)).toBe(rowDay(new Date(today.getTime() + MS_PER_DAY)));

    const stored = await testPrisma.recurringTransaction.findUnique({ where: { id } });
    expect(rowDay(stored!.nextOccurrenceDate)).toBe(
      rowDay(new Date(today.getTime() + MS_PER_DAY))
    );
  });

  it('gap-fills after startDate is moved earlier', async () => {
    const id = await createRule({ startDate: toIsoDay(daysAgo(10)), frequency: 'DAILY' });

    await generate(id);
    expect(await countTransactions(id)).toBe(11);

    await request(app)
      .patch(`/api/recurring-transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ startDate: toIsoDay(daysAgo(12)) })
      .expect(200);

    const res = await generate(id);
    expect(res.body.data.occurrencesCreated).toBe(2);
    expect(await countTransactions(id)).toBe(13);
  });

  it('batch generation only processes the calling user\'s active rules', async () => {
    const idA = await createRule({ startDate: toIsoDay(daysAgo(2)), frequency: 'DAILY' });

    await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        name: 'B Rule',
        categoryId: foodCatB,
        type: 'EXPENSE',
        amount: '10.00',
        frequency: 'DAILY',
        startDate: toIsoDay(daysAgo(2)),
      })
      .expect(201);

    const res = await request(app)
      .post('/api/recurring-transactions/generate')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.rulesProcessed).toBe(1);
    expect(res.body.data.occurrencesCreated).toBe(3);
    expect(await countTransactions(idA)).toBe(3);

    const bTransactions = await testPrisma.transaction.count({
      where: { userId: userB.id },
    });
    expect(bTransactions).toBe(0);
  });

  // ---------------------------------------------------------------
  // Date edge cases (deterministic service-level tests)
  // --------------------------------------------------------------

  it('backfills monthly occurrences exactly as specified', async () => {
    const rule = await testPrisma.recurringTransaction.create({
      data: {
        userId: userA.id,
        categoryId: salaryCatA,
        type: TransactionType.EXPENSE,
        amount: '10.00',
        name: 'Backfill',
        frequency: Frequency.MONTHLY,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        nextOccurrenceDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: null,
        isActive: true,
      },
    });

    const horizon = new Date(Date.UTC(2026, 3, 10));
    const result = await generateOccurrencesForRule(rule, horizon);

    expect(result.occurrencesCreated).toBe(4);
    expect(rowDay(result.nextOccurrenceDate)).toBe('2026-05-01');

    const rows = await testPrisma.transaction.findMany({
      where: { recurringTransactionId: rule.id },
      orderBy: { transactionDate: 'asc' },
    });
    expect(rows.map((row) => rowDay(row.transactionDate))).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ]);
  });

  it('clamps month-end anchors without losing the anchor day', async () => {
    const rule = await testPrisma.recurringTransaction.create({
      data: {
        userId: userA.id,
        categoryId: salaryCatA,
        type: TransactionType.EXPENSE,
        amount: '10.00',
        name: 'Month end',
        frequency: Frequency.MONTHLY,
        startDate: new Date(Date.UTC(2026, 0, 31)),
        nextOccurrenceDate: new Date(Date.UTC(2026, 0, 31)),
        endDate: null,
        isActive: true,
      },
    });

    const result = await generateOccurrencesForRule(rule, new Date(Date.UTC(2026, 3, 30)));

    expect(result.occurrencesCreated).toBe(4);

    const rows = await testPrisma.transaction.findMany({
      where: { recurringTransactionId: rule.id },
      orderBy: { transactionDate: 'asc' },
    });
    expect(rows.map((row) => rowDay(row.transactionDate))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('clamps month-end anchors in leap years', async () => {
    const rule = await testPrisma.recurringTransaction.create({
      data: {
        userId: userA.id,
        categoryId: salaryCatA,
        type: TransactionType.EXPENSE,
        amount: '10.00',
        name: 'Leap month',
        frequency: Frequency.MONTHLY,
        startDate: new Date(Date.UTC(2028, 0, 31)),
        nextOccurrenceDate: new Date(Date.UTC(2028, 0, 31)),
        endDate: null,
        isActive: true,
      },
    });

    const result = await generateOccurrencesForRule(rule, new Date(Date.UTC(2028, 2, 31)));

    expect(result.occurrencesCreated).toBe(3);

    const rows = await testPrisma.transaction.findMany({
      where: { recurringTransactionId: rule.id },
      orderBy: { transactionDate: 'asc' },
    });
    expect(rows.map((row) => rowDay(row.transactionDate))).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('handles yearly February 29 anchors across non-leap years', async () => {
    const rule = await testPrisma.recurringTransaction.create({
      data: {
        userId: userA.id,
        categoryId: salaryCatA,
        type: TransactionType.EXPENSE,
        amount: '10.00',
        name: 'Leap yearly',
        frequency: Frequency.YEARLY,
        startDate: new Date(Date.UTC(2028, 1, 29)),
        nextOccurrenceDate: new Date(Date.UTC(2028, 1, 29)),
        endDate: null,
        isActive: true,
      },
    });

    const result = await generateOccurrencesForRule(rule, new Date(Date.UTC(2032, 1, 29)));

    expect(result.occurrencesCreated).toBe(5);

    const rows = await testPrisma.transaction.findMany({
      where: { recurringTransactionId: rule.id },
      orderBy: { transactionDate: 'asc' },
    });
    expect(rows.map((row) => rowDay(row.transactionDate))).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('never generates occurrences before the start date', async () => {
    const rule = await testPrisma.recurringTransaction.create({
      data: {
        userId: userA.id,
        categoryId: salaryCatA,
        type: TransactionType.EXPENSE,
        amount: '10.00',
        name: 'Future start',
        frequency: Frequency.DAILY,
        startDate: new Date(today.getTime() + 5 * MS_PER_DAY),
        nextOccurrenceDate: new Date(today.getTime() + 5 * MS_PER_DAY),
        endDate: null,
        isActive: true,
      },
    });

    const result = await generateOccurrencesForRule(rule, today);

    expect(result.occurrencesCreated).toBe(0);
    expect(await countTransactions(rule.id)).toBe(0);
  });

  // ---------------------------------------------------------------
  // Financial integration
  // --------------------------------------------------------------

  it('generated transactions appear in the normal transaction list', async () => {
    const id = await createRule({ startDate: toIsoDay(daysAgo(1)), frequency: 'DAILY' });
    await generate(id);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.transactions).toHaveLength(2);
    const descriptions = res.body.data.transactions.map((tx: { description: string }) => tx.description);
    expect(descriptions).toEqual(['Groceries', 'Groceries']);
    expect(res.body.data.transactions[0].category.name).toBe('Food');
  });

  it('generated expenses affect budget progress', async () => {
    const id = await createRule({
      name: 'Budget expense',
      startDate: toIsoDay(today),
      frequency: 'DAILY',
      amount: '40.00',
    });
    await generate(id);

    const budgetRes = await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Monthly',
        amount: '100.00',
        month: currentUtcMonth(),
        categoryId: foodCatA,
      })
      .expect(201);

    const budgetId = budgetRes.body.data.budget.id;

    const progress = await request(app)
      .get(`/api/budgets/${budgetId}/progress`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(progress.body.data.progress.spent).toBe(40);
    expect(progress.body.data.progress.transactionCount).toBe(1);
  });

  it('generated income affects the dashboard summary', async () => {
    const id = await createRule({
      name: 'Salary',
      categoryId: salaryCatA,
      type: 'INCOME',
      amount: '3000.00',
      startDate: toIsoDay(today),
      frequency: 'MONTHLY',
    });
    await generate(id);

    const res = await request(app)
      .get(`/api/dashboard/summary?month=${currentUtcMonth()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.monthlySummary.income).toBe(3000);
    expect(res.body.data.monthlySummary.transactionCount).toBe(1);
  });

  it('keeps generated transactions after the recurrence is deleted', async () => {
    const id = await createRule({ startDate: toIsoDay(daysAgo(1)), frequency: 'DAILY' });
    await generate(id);
    expect(await countTransactions(id)).toBe(2);

    await request(app)
      .delete(`/api/recurring-transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const rows = await testPrisma.transaction.findMany({
      where: { userId: userA.id },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.recurringTransactionId === null)).toBe(true);
  });
});
