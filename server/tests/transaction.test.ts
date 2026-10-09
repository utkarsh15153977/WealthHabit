import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import {
  Role,
  AccountStatus,
  CategoryType,
  TransactionType,
  FinancialAccountType,
  FinancialConnectionProvider,
  TransactionSource,
} from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';
import budgetRoutes from '../src/routes/budgetRoutes.js';

describe('Transactions API', () => {
  let app: express.Express;
  let userA: { id: string; email: string; password: string; firstName: string; lastName: string };
  let userB: { id: string; email: string; password: string; firstName: string; lastName: string };
  let tokenA: string;
  let tokenB: string;
  let expenseCatA: string;
  let incomeCatA: string;
  let privateCatB: string;

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

    userA = { ...a, id: createdA.id };
    userB = { ...b, id: createdB.id };
    tokenA = authService.generateAccessToken({ id: createdA.id, role: createdA.role });
    tokenB = authService.generateAccessToken({ id: createdB.id, role: createdB.role });

    const exp = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Food', type: CategoryType.EXPENSE },
    });
    const inc = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Salary', type: CategoryType.INCOME },
    });
    const priv = await testPrisma.category.create({
      data: { userId: createdB.id, name: 'B Private', type: CategoryType.EXPENSE },
    });
    expenseCatA = exp.id;
    incomeCatA = inc.id;
    privateCatB = priv.id;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/categories', categoryRoutes);
    app.use('/api/transactions', transactionRoutes);
    app.use('/api/budgets', budgetRoutes);
    app.use(errorHandler);
  });

  async function createTx(token: string, body: Record<string, unknown>) {
    return request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('rejects unauthenticated create', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ categoryId: expenseCatA, type: 'EXPENSE', amount: '10.00', transactionDate: new Date().toISOString() });
    expect(res.status).toBe(401);
  });

  it('creates an income transaction', async () => {
    const res = await createTx(tokenA, {
      categoryId: incomeCatA,
      type: 'INCOME',
      amount: '2500.50',
      description: 'Monthly salary',
      transactionDate: '2026-01-15T00:00:00.000Z',
      paymentMethod: 'bank',
      notes: 'January',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transaction.type).toBe('INCOME');
    expect(res.body.data.transaction.amount).toBe(2500.5);
    expect(res.body.data.transaction.categoryId).toBe(incomeCatA);
    expect(res.body.data.transaction.userId).toBeUndefined();
  });

  it('creates an expense transaction', async () => {
    const res = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '42.75',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.transaction.type).toBe('EXPENSE');
    expect(res.body.data.transaction.amount).toBe(42.75);
  });

  it('rejects validation failure (negative amount)', async () => {
    const res = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '-5',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects validation failure (zero amount)', async () => {
    const res = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '0',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields (userId)', async () => {
    const res = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '10.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
      userId: userB.id,
    });
    expect(res.status).toBe(400);
  });

  it('rejects another user private category', async () => {
    const res = await createTx(tokenA, {
      categoryId: privateCatB,
      type: 'EXPENSE',
      amount: '10.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('rejects non-existent category', async () => {
    const res = await createTx(tokenA, {
      categoryId: 'non-existent-cat',
      type: 'EXPENSE',
      amount: '10.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('lists only current user transactions', async () => {
    await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '10.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });

    await testPrisma.transaction.create({
      data: {
        userId: userB.id,
        categoryId: privateCatB,
        type: 'EXPENSE',
        amount: '99.99',
        transactionDate: new Date('2026-01-17T12:00:00.000Z'),
      },
    });

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.pagination.total).toBe(1);
    expect(res.body.data.transactions[0].amount).toBe(10);
  });

  it('filters by type', async () => {
    await createTx(tokenA, {
      categoryId: incomeCatA,
      type: 'INCOME',
      amount: '100',
      transactionDate: '2026-01-10T12:00:00.000Z',
    });
    await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '20',
      transactionDate: '2026-01-11T12:00:00.000Z',
    });

    const res = await request(app)
      .get('/api/transactions?type=INCOME')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].type).toBe('INCOME');
  });

  it('filters by date range', async () => {
    await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '10',
      transactionDate: '2026-01-05T12:00:00.000Z',
    });
    await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '20',
      transactionDate: '2026-02-05T12:00:00.000Z',
    });

    const res = await request(app)
      .get('/api/transactions?dateFrom=2026-01-15&dateTo=2026-02-28')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].amount).toBe(20);
  });

  it('treats dateTo as an inclusive calendar day', async () => {
    await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '5',
      transactionDate: '2026-03-10T23:30:00.000Z',
    });
    await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '7',
      transactionDate: '2026-03-11T00:00:00.000Z',
    });

    const res = await request(app)
      .get('/api/transactions?dateFrom=2026-03-01&dateTo=2026-03-10')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].amount).toBe(5);
  });

  it('treats dateFrom as an inclusive calendar day', async () => {
    await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '3',
      transactionDate: '2026-03-01T00:30:00.000Z',
    });
    await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '4',
      transactionDate: '2026-02-28T23:59:00.000Z',
    });

    const res = await request(app)
      .get('/api/transactions?dateFrom=2026-03-01&dateTo=2026-03-31')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(1);
    expect(res.body.data.transactions[0].amount).toBe(3);
  });

  it('paginates list', async () => {
    for (let i = 0; i < 3; i++) {
      await createTx(tokenA, {
        categoryId: expenseCatA,
        type: 'EXPENSE',
        amount: String(i + 1),
        transactionDate: `2026-01-1${i}T12:00:00.000Z`,
      });
    }

    const res = await request(app)
      .get('/api/transactions?page=1&limit=2')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(2);
    expect(res.body.data.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
  });

  it('gets own transaction', async () => {
    const created = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '15.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    const id = created.body.data.transaction.id;

    const res = await request(app)
      .get(`/api/transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.transaction.id).toBe(id);
    expect(res.body.data.transaction.category).toBeDefined();
  });

  it('rejects get of another user transaction', async () => {
    const created = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '15.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    const id = created.body.data.transaction.id;

    const res = await request(app)
      .get(`/api/transactions/${id}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TRANSACTION_NOT_FOUND');
  });

  it('updates own transaction', async () => {
    const created = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '15.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    const id = created.body.data.transaction.id;

    const res = await request(app)
      .patch(`/api/transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ amount: '25.50', description: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.data.transaction.amount).toBe(25.5);
    expect(res.body.data.transaction.description).toBe('Updated');
  });

  it('rejects update of another user transaction', async () => {
    const created = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '15.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    const id = created.body.data.transaction.id;

    const res = await request(app)
      .patch(`/api/transactions/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ amount: '999.00' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TRANSACTION_NOT_FOUND');
  });

  it('cannot change ownership via update', async () => {
    const created = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '15.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    const id = created.body.data.transaction.id;

    const res = await request(app)
      .patch(`/api/transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ userId: userB.id, amount: '16.00' });

    expect(res.status).toBe(400);

    const stillOwned = await testPrisma.transaction.findUnique({ where: { id } });
    expect(stillOwned?.userId).toBe(userA.id);
  });

  it('deletes own transaction', async () => {
    const created = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '15.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    const id = created.body.data.transaction.id;

    const res = await request(app)
      .delete(`/api/transactions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const found = await testPrisma.transaction.findUnique({ where: { id } });
    expect(found).toBeNull();
  });

  it('rejects delete of another user transaction', async () => {
    const created = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'EXPENSE',
      amount: '15.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    const id = created.body.data.transaction.id;

    const res = await request(app)
      .delete(`/api/transactions/${id}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TRANSACTION_NOT_FOUND');

    const stillThere = await testPrisma.transaction.findUnique({ where: { id } });
    expect(stillThere).not.toBeNull();
  });

  it('rejects listing with another user private categoryId filter', async () => {
    const res = await request(app)
      .get(`/api/transactions?categoryId=${privateCatB}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('rejects invalid type enum', async () => {
    const res = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: 'TRANSFER',
      amount: '10.00',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });
    expect(res.status).toBe(400);
  });

  it('preserves amount cents as number in response', async () => {
    const res = await createTx(tokenA, {
      categoryId: expenseCatA,
      type: TransactionType.EXPENSE,
      amount: '0.10',
      transactionDate: '2026-01-16T12:00:00.000Z',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.transaction.amount).toBe(0.1);
    const db = await testPrisma.transaction.findUnique({
      where: { id: res.body.data.transaction.id },
    });
    expect(db?.amount.toString()).toBe('0.1');
  });

  describe('FIN-002 transaction/category type consistency', () => {
    const MISMATCH_MESSAGE = 'Category type must match the transaction type';

    it('accepts an expense transaction with an expense category', async () => {
      const res = await createTx(tokenA, {
        categoryId: expenseCatA,
        type: 'EXPENSE',
        amount: '30.00',
        transactionDate: '2026-01-20T10:00:00.000Z',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.transaction.type).toBe('EXPENSE');
      expect(res.body.data.transaction.category.type).toBe('EXPENSE');
    });

    it('accepts an income transaction with an income category', async () => {
      const res = await createTx(tokenA, {
        categoryId: incomeCatA,
        type: 'INCOME',
        amount: '1200.00',
        transactionDate: '2026-01-20T10:00:00.000Z',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.transaction.type).toBe('INCOME');
      expect(res.body.data.transaction.category.type).toBe('INCOME');
    });

    it('rejects an expense transaction with an income category', async () => {
      const res = await createTx(tokenA, {
        categoryId: incomeCatA,
        type: 'EXPENSE',
        amount: '30.00',
        transactionDate: '2026-01-20T10:00:00.000Z',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body.categoryId']).toEqual([MISMATCH_MESSAGE]);
      expect(await testPrisma.transaction.count({ where: { userId: userA.id } })).toBe(0);
    });

    it('rejects an income transaction with an expense category', async () => {
      const res = await createTx(tokenA, {
        categoryId: expenseCatA,
        type: 'INCOME',
        amount: '30.00',
        transactionDate: '2026-01-20T10:00:00.000Z',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body.categoryId']).toEqual([MISMATCH_MESSAGE]);
      expect(await testPrisma.transaction.count({ where: { userId: userA.id } })).toBe(0);
    });

    it('rejects an update that moves the transaction to a mismatching category', async () => {
      const created = await createTx(tokenA, {
        categoryId: expenseCatA,
        type: 'EXPENSE',
        amount: '60.00',
        transactionDate: '2026-01-21T10:00:00.000Z',
      });
      const id = created.body.data.transaction.id;

      const res = await request(app)
        .patch(`/api/transactions/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ categoryId: incomeCatA });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body.categoryId']).toEqual([MISMATCH_MESSAGE]);

      const unchanged = await testPrisma.transaction.findUnique({
        where: { id },
        include: { category: true },
      });
      expect(unchanged?.type).toBe('EXPENSE');
      expect(unchanged?.categoryId).toBe(expenseCatA);
      expect(unchanged?.category.type).toBe('EXPENSE');
    });

    it('rejects an update that changes the type away from the existing category', async () => {
      const created = await createTx(tokenA, {
        categoryId: expenseCatA,
        type: 'EXPENSE',
        amount: '65.00',
        transactionDate: '2026-01-21T11:00:00.000Z',
      });
      const id = created.body.data.transaction.id;

      const res = await request(app)
        .patch(`/api/transactions/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'INCOME' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body.type']).toEqual([MISMATCH_MESSAGE]);

      const unchanged = await testPrisma.transaction.findUnique({
        where: { id },
        include: { category: true },
      });
      expect(unchanged?.type).toBe('EXPENSE');
      expect(unchanged?.category.type).toBe('EXPENSE');
    });

    it('accepts an update that changes type and category together to a matching pair', async () => {
      const created = await createTx(tokenA, {
        categoryId: expenseCatA,
        type: 'EXPENSE',
        amount: '70.00',
        transactionDate: '2026-01-21T12:00:00.000Z',
      });
      const id = created.body.data.transaction.id;

      const res = await request(app)
        .patch(`/api/transactions/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'INCOME', categoryId: incomeCatA, description: 'Reclassified' });

      expect(res.status).toBe(200);
      expect(res.body.data.transaction.type).toBe('INCOME');
      expect(res.body.data.transaction.categoryId).toBe(incomeCatA);
      expect(res.body.data.transaction.category.type).toBe('INCOME');
      expect(res.body.data.transaction.description).toBe('Reclassified');
    });

    it('accepts an update that changes neither type nor category', async () => {
      const created = await createTx(tokenA, {
        categoryId: expenseCatA,
        type: 'EXPENSE',
        amount: '75.00',
        transactionDate: '2026-01-21T13:00:00.000Z',
      });
      const id = created.body.data.transaction.id;

      const res = await request(app)
        .patch(`/api/transactions/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: '80.00', paymentMethod: 'card' });

      expect(res.status).toBe(200);
      expect(res.body.data.transaction.type).toBe('EXPENSE');
      expect(res.body.data.transaction.categoryId).toBe(expenseCatA);
      expect(res.body.data.transaction.amount).toBe(80);
      expect(res.body.data.transaction.paymentMethod).toBe('card');
    });

    it('keeps rejecting another user category', async () => {
      const res = await createTx(tokenA, {
        categoryId: privateCatB,
        type: 'EXPENSE',
        amount: '10.00',
        transactionDate: '2026-01-21T14:00:00.000Z',
      });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('keeps a matching expense counted by budget progress and blocks the bypass', async () => {
      const month = '2026-03';
      const inMonth = '2026-03-12T10:00:00.000Z';

      const budget = await request(app)
        .post('/api/budgets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Food Budget', amount: '500', month, categoryId: expenseCatA });
      expect(budget.status).toBe(201);
      const budgetId = budget.body.data.budget.id;

      const valid = await createTx(tokenA, {
        categoryId: expenseCatA,
        type: 'EXPENSE',
        amount: '100.00',
        transactionDate: inMonth,
      });
      expect(valid.status).toBe(201);

      const attempt = await createTx(tokenA, {
        categoryId: incomeCatA,
        type: 'EXPENSE',
        amount: '400.00',
        transactionDate: inMonth,
      });
      expect(attempt.status).toBe(400);
      expect(attempt.body.errors['body.categoryId']).toEqual([MISMATCH_MESSAGE]);

      const progress = await request(app)
        .get(`/api/budgets/${budgetId}/progress`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(progress.status).toBe(200);
      expect(progress.body.data.progress).toMatchObject({
        budgetAmount: 500,
        spent: 100,
        remaining: 400,
        percentageUsed: 20,
        transactionCount: 1,
      });
    });
  });

  describe('imported transaction metadata', () => {
    async function seedOwnedAccount(userId: string) {
      const suffix = Math.random().toString(36).slice(2, 8);
      const connection = await testPrisma.financialConnection.create({
        data: {
          userId,
          provider: FinancialConnectionProvider.MOCK,
          institutionName: 'Demo Bank',
        },
      });
      const account = await testPrisma.financialAccount.create({
        data: {
          connectionId: connection.id,
          userId,
          externalAccountId: `ext-${suffix}`,
          name: 'Everyday Savings',
          mask: '4821',
          type: FinancialAccountType.SAVINGS,
          currency: 'USD',
          institutionName: 'Demo Bank',
        },
      });
      return { connection, account };
    }

    async function seedImportedTx(
      userId: string,
      categoryId: string,
      accountId: string
    ) {
      const suffix = Math.random().toString(36).slice(2, 10);
      return testPrisma.transaction.create({
        data: {
          userId,
          categoryId,
          type: TransactionType.EXPENSE,
          amount: '42.50',
          transactionDate: new Date('2026-04-02T09:30:00.000Z'),
          description: 'LATTE',
          paymentMethod: 'UPI',
          source: TransactionSource.IMPORTED,
          financialAccountId: accountId,
          merchant: 'Blue Bottle',
          paymentChannel: 'GOOGLEPAY',
          externalTransactionId: `ext-tx-${suffix}`,
          importedAt: new Date('2026-04-02T10:00:00.000Z'),
        },
      });
    }

    async function listAs(token: string) {
      const res = await request(app)
        .get('/api/transactions')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return res.body.data.transactions as any[];
    }

    it('returns source, merchant, payment channel and the linked account summary', async () => {
      const { account } = await seedOwnedAccount(userA.id);
      await seedImportedTx(userA.id, expenseCatA, account.id);

      const tx = (await listAs(tokenA)).find((t) => t.merchant === 'Blue Bottle');
      expect(tx).toBeDefined();
      expect(tx.source).toBe('IMPORTED');
      expect(tx.merchant).toBe('Blue Bottle');
      expect(tx.paymentChannel).toBe('GOOGLEPAY');
      expect(tx.paymentMethod).toBe('UPI');
      expect(tx.description).toBe('LATTE');
      expect(tx.financialAccountId).toBe(account.id);
      expect(tx.financialAccount).toEqual({
        id: account.id,
        name: 'Everyday Savings',
        mask: '4821',
        type: 'SAVINGS',
        currency: 'USD',
        institutionName: 'Demo Bank',
      });
    });

    it('exposes only safe display fields on the account summary', async () => {
      const { account } = await seedOwnedAccount(userA.id);
      await seedImportedTx(userA.id, expenseCatA, account.id);

      const tx = (await listAs(tokenA))[0];
      expect(Object.keys(tx.financialAccount).sort()).toEqual(
        ['currency', 'id', 'institutionName', 'mask', 'name', 'type'].sort()
      );
      expect(tx.financialAccount).not.toHaveProperty('userId');
      expect(tx.financialAccount).not.toHaveProperty('connectionId');
      expect(tx.financialAccount).not.toHaveProperty('externalAccountId');
      expect(tx.financialAccount).not.toHaveProperty('lastSyncError');
      expect(tx.financialAccount).not.toHaveProperty('providerMetadata');
      expect(tx).not.toHaveProperty('userId');
      expect(tx).not.toHaveProperty('dedupKey');
      expect(tx).not.toHaveProperty('externalTransactionId');
    });

    it('serialises manual transactions with null optional metadata', async () => {
      const created = await createTx(tokenA, {
        categoryId: expenseCatA,
        type: 'EXPENSE',
        amount: '10.00',
        transactionDate: '2026-01-16T12:00:00.000Z',
        description: 'Manual groceries',
      });
      expect(created.status).toBe(201);

      const tx = created.body.data.transaction;
      expect(tx.source).toBe('MANUAL');
      expect(tx.merchant).toBeNull();
      expect(tx.paymentChannel).toBeNull();
      expect(tx.financialAccountId).toBeNull();
      expect(tx.financialAccount).toBeNull();
      expect(tx.description).toBe('Manual groceries');
    });

    it('keeps list, detail and update responses consistent for imported rows', async () => {
      const { account } = await seedOwnedAccount(userA.id);
      const seeded = await seedImportedTx(userA.id, expenseCatA, account.id);

      const listed = (await listAs(tokenA)).find((t) => t.id === seeded.id);
      expect(listed).toBeDefined();

      const detail = await request(app)
        .get(`/api/transactions/${seeded.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(detail.status).toBe(200);
      const detailTx = detail.body.data.transaction;

      const metadata = (tx: any) => ({
        source: tx.source,
        merchant: tx.merchant,
        paymentChannel: tx.paymentChannel,
        financialAccountId: tx.financialAccountId,
        financialAccount: tx.financialAccount,
      });
      expect(metadata(detailTx)).toEqual(metadata(listed));

      const updated = await request(app)
        .patch(`/api/transactions/${seeded.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: '50.00', description: 'Updated by user' });
      expect(updated.status).toBe(200);

      const updatedTx = updated.body.data.transaction;
      expect(updatedTx.amount).toBe(50);
      expect(updatedTx.description).toBe('Updated by user');
      expect(metadata(updatedTx)).toEqual(metadata(listed));

      const after = (await listAs(tokenA)).find((t) => t.id === seeded.id);
      expect(metadata(after)).toEqual(metadata(listed));
    });

    it('never returns another user account through transaction metadata', async () => {
      const { account: foreignAccount } = await seedOwnedAccount(userB.id);
      const seeded = await seedImportedTx(userA.id, expenseCatA, foreignAccount.id);

      const res = await request(app)
        .get(`/api/transactions/${seeded.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);

      const tx = res.body.data.transaction;
      expect(tx.financialAccount).toBeNull();
      expect(tx.financialAccountId).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('Everyday Savings');
      expect(JSON.stringify(res.body)).not.toContain('4821');
      expect(JSON.stringify(res.body)).not.toContain(foreignAccount.id);

      const asOwner = await request(app)
        .get(`/api/transactions/${seeded.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(asOwner.status).toBe(404);
    });

    it('lists only the requesting user imported rows with their own account', async () => {
      const { account: accountA } = await seedOwnedAccount(userA.id);
      const { account: accountB } = await seedOwnedAccount(userB.id);
      const txA = await seedImportedTx(userA.id, expenseCatA, accountA.id);
      await seedImportedTx(userB.id, privateCatB, accountB.id);

      const rowsA = await listAs(tokenA);
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0].id).toBe(txA.id);
      expect(rowsA[0].financialAccount.id).toBe(accountA.id);
      expect(rowsA[0].financialAccount.name).toBe('Everyday Savings');

      const rowsB = await listAs(tokenB);
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0].id).not.toBe(txA.id);
      expect(rowsB[0].financialAccount.id).toBe(accountB.id);
    });
  });
});
