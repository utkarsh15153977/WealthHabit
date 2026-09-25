import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, CategoryType, TransactionType } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';

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
});
