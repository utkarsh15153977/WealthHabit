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
import budgetRoutes from '../src/routes/budgetRoutes.js';
import dashboardRoutes from '../src/routes/dashboardRoutes.js';
import billRoutes from '../src/routes/billRoutes.js';
import { advanceObligation } from '../src/utils/recurrence.js';
import { startOfUtcDay, currentUtcMonth } from '../src/utils/date.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = startOfUtcDay(new Date());

function daysFromToday(days: number): Date {
  return new Date(today.getTime() + days * MS_PER_DAY);
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe('Bills API', () => {
  let app: express.Express;
  let userA: { id: string };
  let tokenA: string;
  let tokenB: string;
  let expenseCatA: string;
  let incomeCatA: string;
  let systemExpenseCat: string;
  let expenseCatB: string;

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
    tokenA = authService.generateAccessToken({ id: createdA.id, role: createdA.role });
    tokenB = authService.generateAccessToken({ id: createdB.id, role: createdB.role });

    const expenseA = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Bills Expense', type: CategoryType.EXPENSE },
    });
    const incomeA = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Salary', type: CategoryType.INCOME },
    });
    const systemExpense = await testPrisma.category.create({
      data: { userId: null, name: 'System Bills Expense', type: CategoryType.EXPENSE, isDefault: true },
    });
    const expenseB = await testPrisma.category.create({
      data: { userId: createdB.id, name: 'B Bills Expense', type: CategoryType.EXPENSE },
    });

    expenseCatA = expenseA.id;
    incomeCatA = incomeA.id;
    systemExpenseCat = systemExpense.id;
    expenseCatB = expenseB.id;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/categories', categoryRoutes);
    app.use('/api/transactions', transactionRoutes);
    app.use('/api/budgets', budgetRoutes);
    app.use('/api/bills', billRoutes);
    app.use('/api/dashboard', dashboardRoutes);
    app.use(errorHandler);
  });

  function createBillPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Internet',
      amount: '49.99',
      frequency: 'MONTHLY',
      dueDate: toIsoDay(daysFromToday(5)),
      ...overrides,
    };
  }

  async function createBill(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload(overrides));

    expect(res.status).toBe(201);
    return res.body.data.bill.id as string;
  }

  function getBill(id: string, token: string = tokenA) {
    return request(app).get(`/api/bills/${id}`).set('Authorization', `Bearer ${token}`);
  }

  function patchBill(id: string, body: Record<string, unknown>, token: string = tokenA) {
    return request(app).patch(`/api/bills/${id}`).set('Authorization', `Bearer ${token}`).send(body);
  }

  // ---------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------

  it('creates a bill with PENDING defaults and nextDueDate = dueDate', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ dueDate: toIsoDay(daysFromToday(5)) }));

    expect(res.status).toBe(201);
    const bill = res.body.data.bill;
    expect(bill.name).toBe('Internet');
    expect(bill.amount).toBe(49.99);
    expect(bill.frequency).toBe('MONTHLY');
    expect(bill.status).toBe('PENDING');
    expect(bill.autoPay).toBe(false);
    expect(bill.categoryId).toBeNull();
    expect(bill.category).toBeNull();
    expect(bill.dueState).toBe('UPCOMING');
    expect(toIsoDay(new Date(bill.dueDate))).toBe(toIsoDay(daysFromToday(5)));
    expect(toIsoDay(new Date(bill.nextDueDate))).toBe(toIsoDay(daysFromToday(5)));
  });

  it('creates a bill with an expense category summary', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ categoryId: expenseCatA }));

    expect(res.status).toBe(201);
    const bill = res.body.data.bill;
    expect(bill.categoryId).toBe(expenseCatA);
    expect(bill.category).toMatchObject({ id: expenseCatA, name: 'Bills Expense', type: 'EXPENSE' });
  });

  it('creates a bill linked to a system (shared) expense category', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ categoryId: systemExpenseCat }));

    expect(res.status).toBe(201);
    expect(res.body.data.bill.categoryId).toBe(systemExpenseCat);
    expect(res.body.data.bill.category.isDefault).toBe(true);
  });

  it('accepts DAILY and YEARLY frequencies', async () => {
    const daily = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ name: 'Daily fee', frequency: 'DAILY' }));
    expect(daily.status).toBe(201);

    const yearly = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ name: 'Insurance', frequency: 'YEARLY' }));
    expect(yearly.status).toBe(201);
    expect(yearly.body.data.bill.frequency).toBe('YEARLY');
  });

  it('lists bills sorted by nextDueDate ascending', async () => {
    const later = await createBill({ name: 'Later', dueDate: toIsoDay(daysFromToday(20)) });
    const sooner = await createBill({ name: 'Sooner', dueDate: toIsoDay(daysFromToday(2)) });

    const res = await request(app)
      .get('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const bills = res.body.data.bills as { id: string }[];
    expect(bills).toHaveLength(2);
    expect(bills[0].id).toBe(sooner);
    expect(bills[1].id).toBe(later);
  });

  it('returns only the authenticated user bills', async () => {
    await createBill({ name: 'A Bill' });
    await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenB}`)
      .send(createBillPayload({ name: 'B Bill' }))
      .expect(201);

    const resA = await request(app)
      .get('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(resA.body.data.bills).toHaveLength(1);
    expect(resA.body.data.bills[0].name).toBe('A Bill');
  });

  it('updates bill fields', async () => {
    const id = await createBill();

    const res = await patchBill(id, { name: 'Fiber', amount: '59.95', autoPay: true }).expect(200);

    const bill = res.body.data.bill;
    expect(bill.name).toBe('Fiber');
    expect(bill.amount).toBe(59.95);
    expect(bill.autoPay).toBe(true);
    expect(bill.frequency).toBe('MONTHLY');
  });

  it('clears the category with categoryId: null', async () => {
    const id = await createBill({ categoryId: expenseCatA });

    const res = await patchBill(id, { categoryId: null }).expect(200);

    expect(res.body.data.bill.categoryId).toBeNull();
    expect(res.body.data.bill.category).toBeNull();
  });

  it('deletes a bill and subsequent access returns 404', async () => {
    const id = await createBill();

    await request(app)
      .delete(`/api/bills/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    await getBill(id).expect(404);
    await request(app)
      .delete(`/api/bills/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('rejects unauthenticated requests with 401', async () => {
    await request(app).get('/api/bills').expect(401);
    await request(app).post('/api/bills').send(createBillPayload()).expect(401);
  });

  // ---------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------

  it('rejects a missing name', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ name: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors['body.name']).toBeDefined();
  });

  it('rejects a non-positive amount', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ amount: '-1' }));

    expect(res.status).toBe(400);
    expect(res.body.errors['body.amount']).toBeDefined();
  });

  it('rejects an invalid frequency', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ frequency: 'BIWEEKLY' }));

    expect(res.status).toBe(400);
    expect(res.body.errors['body.frequency']).toBeDefined();
  });

  it('rejects an invalid dueDate', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ dueDate: 'not-a-date' }));

    expect(res.status).toBe(400);
    expect(res.body.errors['body.dueDate']).toBeDefined();
  });

  it('rejects unknown body fields (strict schema)', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ bogus: true }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors['body']).toBeDefined();
  });

  it('rejects an update with an empty body', async () => {
    const id = await createBill();

    const res = await patchBill(id, {}).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an income category with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ categoryId: incomeCatA }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors['body.categoryId']).toBeDefined();
  });

  it("rejects another user's category with 404", async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createBillPayload({ categoryId: expenseCatB }));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('rejects an invalid list query filter', async () => {
    const res = await request(app)
      .get('/api/bills?status=NOT_A_STATUS')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(400);
    expect(res.body.errors['query.status']).toBeDefined();
  });

  // ---------------------------------------------------------------
  // Ownership
  // --------------------------------------------------------------

  it("denies another user's bill with 404 BILL_NOT_FOUND", async () => {
    const id = await createBill();

    const getRes = await getBill(id, tokenB).expect(404);
    expect(getRes.body.error.code).toBe('BILL_NOT_FOUND');

    const patchRes = await patchBill(id, { name: 'Hijacked' }, tokenB).expect(404);
    expect(patchRes.body.error.code).toBe('BILL_NOT_FOUND');

    await request(app)
      .delete(`/api/bills/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    const untouched = await getBill(id).expect(200);
    expect(untouched.body.data.bill.name).toBe('Internet');
  });

  // ---------------------------------------------------------------
  // Filters
  // --------------------------------------------------------------

  it('filters bills by status', async () => {
    await createBill({ name: 'Active bill' });
    const cancelledId = await createBill({ name: 'Cancelled bill' });
    await patchBill(cancelledId, { status: 'CANCELLED' }).expect(200);

    const res = await request(app)
      .get('/api/bills?status=CANCELLED')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.bills).toHaveLength(1);
    expect(res.body.data.bills[0].name).toBe('Cancelled bill');
  });

  it('filters bills by month window on nextDueDate', async () => {
    const due = daysFromToday(3);
    await createBill({ name: 'In window', dueDate: toIsoDay(due) });
    await createBill({ name: 'Out of window', dueDate: toIsoDay(daysFromToday(400)) });

    const monthKey = toIsoDay(due).slice(0, 7);
    const res = await request(app)
      .get(`/api/bills?month=${monthKey}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.bills).toHaveLength(1);
    expect(res.body.data.bills[0].name).toBe('In window');
  });

  it('rejects a malformed month filter', async () => {
    const res = await request(app)
      .get('/api/bills?month=2026-13')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(400);
    expect(res.body.errors['query.month']).toBeDefined();
  });

  it('filters active bills as everything except CANCELLED', async () => {
    await createBill({ name: 'Pending bill' });
    await createBill({ name: 'Paid bill', status: 'PAID' });
    const cancelledId = await createBill({ name: 'Cancelled bill' });
    await patchBill(cancelledId, { status: 'CANCELLED' }).expect(200);

    const active = await request(app)
      .get('/api/bills?active=true')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(active.body.data.bills).toHaveLength(2);

    const inactive = await request(app)
      .get('/api/bills?active=false')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(inactive.body.data.bills).toHaveLength(1);
    expect(inactive.body.data.bills[0].name).toBe('Cancelled bill');
  });

  // ---------------------------------------------------------------
  // Due state (derived, never persisted)
  // --------------------------------------------------------------

  it('derives UPCOMING, DUE and OVERDUE from nextDueDate', async () => {
    await createBill({ name: 'Upcoming', dueDate: toIsoDay(daysFromToday(4)) });
    await createBill({ name: 'Due', dueDate: toIsoDay(today) });
    await createBill({ name: 'Overdue', dueDate: toIsoDay(daysFromToday(-4)) });

    const res = await request(app)
      .get('/api/bills')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const byName = new Map(
      (res.body.data.bills as { name: string; dueState: string; status: string }[]).map((b) => [
        b.name,
        b,
      ])
    );
    expect(byName.get('Upcoming')?.dueState).toBe('UPCOMING');
    expect(byName.get('Due')?.dueState).toBe('DUE');
    expect(byName.get('Overdue')?.dueState).toBe('OVERDUE');
    expect(byName.get('Overdue')?.status).toBe('PENDING');
  });

  it('returns no dueState for a cancelled bill', async () => {
    const id = await createBill({ dueDate: toIsoDay(daysFromToday(-4)) });
    await patchBill(id, { status: 'CANCELLED' }).expect(200);

    const res = await getBill(id).expect(200);
    expect(res.body.data.bill.dueState).toBeNull();
  });

  it('does not persist a due-state into the stored status on read', async () => {
    const id = await createBill({ dueDate: toIsoDay(daysFromToday(-4)) });

    await getBill(id).expect(200);

    const row = await testPrisma.bill.findUnique({ where: { id } });
    expect(row?.status).toBe('PENDING');
    expect(row?.nextDueDate).toEqual(daysFromToday(-4));
  });

  // ---------------------------------------------------------------
  // nextDueDate advance rules
  // --------------------------------------------------------------

  it('advances nextDueDate one month on the dueDate anchor when marking PAID', async () => {
    const id = await createBill({ frequency: 'MONTHLY', dueDate: '2026-01-31' });

    const res = await patchBill(id, { status: 'PAID' }).expect(200);
    const bill = res.body.data.bill;

    expect(bill.status).toBe('PAID');
    expect(bill.dueState).toBe('OVERDUE');
    expect(toIsoDay(new Date(bill.nextDueDate))).toBe('2026-02-28');
  });

  it('re-anchors the clamped advance so the following cycle returns to the 31st', async () => {
    const id = await createBill({ frequency: 'MONTHLY', dueDate: '2026-01-31' });

    await patchBill(id, { status: 'PAID' }).expect(200);
    await patchBill(id, { status: 'PENDING' }).expect(200);
    const res = await patchBill(id, { status: 'PAID' }).expect(200);

    expect(toIsoDay(new Date(res.body.data.bill.nextDueDate))).toBe('2026-03-31');
  });

  it('honours an explicit nextDueDate over the PAID advance', async () => {
    const id = await createBill({ frequency: 'MONTHLY', dueDate: '2026-01-31' });

    const res = await patchBill(id, { status: 'PAID', nextDueDate: '2026-07-15' }).expect(200);

    expect(toIsoDay(new Date(res.body.data.bill.nextDueDate))).toBe('2026-07-15');
  });

  it('resets nextDueDate when only the dueDate changes', async () => {
    const id = await createBill({ dueDate: toIsoDay(daysFromToday(5)) });

    const res = await patchBill(id, { dueDate: '2026-06-10' }).expect(200);

    expect(toIsoDay(new Date(res.body.data.bill.nextDueDate))).toBe('2026-06-10');
  });

  it('does not advance when the status is already PAID', async () => {
    const id = await createBill({ frequency: 'MONTHLY', dueDate: '2026-01-31' });
    const paid = await patchBill(id, { status: 'PAID' }).expect(200);
    const nextAfterFirst = paid.body.data.bill.nextDueDate;

    const again = await patchBill(id, { status: 'PAID' }).expect(200);

    expect(again.body.data.bill.nextDueDate).toBe(nextAfterFirst);
    expect(toIsoDay(new Date(again.body.data.bill.nextDueDate))).toBe('2026-02-28');
  });

  it('keeps a PAID bill PAID after the advance', async () => {
    const id = await createBill({ frequency: 'MONTHLY', dueDate: '2026-01-31' });
    const res = await patchBill(id, { status: 'PAID' }).expect(200);

    expect(res.body.data.bill.status).toBe('PAID');
    const row = await testPrisma.bill.findUnique({ where: { id } });
    expect(row?.status).toBe('PAID');
  });

  // ---------------------------------------------------------------
  // advanceObligation unit tests
  // --------------------------------------------------------------

  describe('advanceObligation', () => {
    it('advances MONTHLY from a Jan 31 anchor without drift', () => {
      const anchor = new Date('2026-01-31T00:00:00.000Z');

      const feb = advanceObligation(anchor, anchor, 'MONTHLY');
      expect(toIsoDay(feb)).toBe('2026-02-28');

      const mar = advanceObligation(anchor, feb, 'MONTHLY');
      expect(toIsoDay(mar)).toBe('2026-03-31');

      const apr = advanceObligation(anchor, mar, 'MONTHLY');
      expect(toIsoDay(apr)).toBe('2026-04-30');

      const may = advanceObligation(anchor, apr, 'MONTHLY');
      expect(toIsoDay(may)).toBe('2026-05-31');
    });

    it('handles leap-year YEARLY anchors across Feb 29', () => {
      const anchor = new Date('2028-02-29T00:00:00.000Z');

      let current = advanceObligation(anchor, anchor, 'YEARLY');
      expect(toIsoDay(current)).toBe('2029-02-28');

      current = advanceObligation(anchor, current, 'YEARLY');
      expect(toIsoDay(current)).toBe('2030-02-28');

      current = advanceObligation(anchor, current, 'YEARLY');
      expect(toIsoDay(current)).toBe('2031-02-28');

      current = advanceObligation(anchor, current, 'YEARLY');
      expect(toIsoDay(current)).toBe('2032-02-29');
    });

    it('returns the anchor when the current date is before it', () => {
      const anchor = new Date('2026-06-15T00:00:00.000Z');
      const earlier = new Date('2026-05-01T00:00:00.000Z');

      expect(toIsoDay(advanceObligation(anchor, earlier, 'MONTHLY'))).toBe('2026-06-15');
      expect(toIsoDay(advanceObligation(anchor, earlier, 'DAILY'))).toBe('2026-06-15');
    });

    it('advances DAILY and WEEKLY on plain calendar math', () => {
      const anchor = new Date('2026-09-25T00:00:00.000Z');

      expect(toIsoDay(advanceObligation(anchor, anchor, 'DAILY'))).toBe('2026-09-26');
      expect(toIsoDay(advanceObligation(anchor, anchor, 'WEEKLY'))).toBe('2026-10-02');

      const dailyCurrent = new Date('2026-10-04T00:00:00.000Z');
      expect(toIsoDay(advanceObligation(anchor, dailyCurrent, 'DAILY'))).toBe('2026-10-05');
      expect(toIsoDay(advanceObligation(anchor, dailyCurrent, 'WEEKLY'))).toBe('2026-10-09');
    });
  });

  // ---------------------------------------------------------------
  // Due is not paid: cross-domain regression
  // --------------------------------------------------------------

  it('due bills never touch transactions, dashboard totals or budgets', async () => {
    await createBill({ name: 'Due bill', amount: '50.00', dueDate: toIsoDay(today) });
    await createBill({ name: 'Overdue bill', amount: '60.00', dueDate: toIsoDay(daysFromToday(-7)) });

    expect(await testPrisma.transaction.count()).toBe(0);

    const summary = await request(app)
      .get(`/api/dashboard/summary?month=${currentUtcMonth()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(summary.body.data.monthlySummary.expenses).toBe(0);
    expect(summary.body.data.monthlySummary.transactionCount).toBe(0);

    await testPrisma.transaction.create({
      data: {
        userId: userA.id,
        categoryId: expenseCatA,
        type: TransactionType.EXPENSE,
        amount: '40.00',
        transactionDate: startOfUtcDay(new Date()),
      },
    });

    expect(await testPrisma.transaction.count()).toBe(1);

    const summaryAfter = await request(app)
      .get(`/api/dashboard/summary?month=${currentUtcMonth()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(summaryAfter.body.data.monthlySummary.expenses).toBe(40);

    const budgetRes = await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Bills regression',
        amount: '100.00',
        month: currentUtcMonth(),
        categoryId: expenseCatA,
      })
      .expect(201);

    const progress = await request(app)
      .get(`/api/budgets/${budgetRes.body.data.budget.id}/progress`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(progress.body.data.progress.spent).toBe(40);
    expect(progress.body.data.progress.transactionCount).toBe(1);
  });

  it('advancing a bill to PAID creates no transaction', async () => {
    const id = await createBill({ frequency: 'MONTHLY', dueDate: toIsoDay(today) });

    await patchBill(id, { status: 'PAID' }).expect(200);

    expect(await testPrisma.transaction.count()).toBe(0);
  });
});
