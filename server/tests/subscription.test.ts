import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, CategoryType, TransactionType } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import dashboardRoutes from '../src/routes/dashboardRoutes.js';
import subscriptionRoutes from '../src/routes/subscriptionRoutes.js';
import { startOfUtcDay, currentUtcMonth } from '../src/utils/date.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = startOfUtcDay(new Date());

function daysFromToday(days: number): Date {
  return new Date(today.getTime() + days * MS_PER_DAY);
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe('Subscriptions API', () => {
  let app: express.Express;
  let userA: { id: string };
  let tokenA: string;
  let tokenB: string;
  let expenseCatA: string;
  let incomeCatA: string;
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
      data: { userId: createdA.id, name: 'Subs Expense', type: CategoryType.EXPENSE },
    });
    const incomeA = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Salary', type: CategoryType.INCOME },
    });
    const expenseB = await testPrisma.category.create({
      data: { userId: createdB.id, name: 'B Subs Expense', type: CategoryType.EXPENSE },
    });

    expenseCatA = expenseA.id;
    incomeCatA = incomeA.id;
    expenseCatB = expenseB.id;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/categories', categoryRoutes);
    app.use('/api/subscriptions', subscriptionRoutes);
    app.use('/api/dashboard', dashboardRoutes);
    app.use(errorHandler);
  });

  function createSubscriptionPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Streaming',
      amount: '9.99',
      billingCycle: 'MONTHLY',
      nextRenewalDate: toIsoDay(daysFromToday(10)),
      ...overrides,
    };
  }

  async function createSubscription(
    overrides: Record<string, unknown> = {}
  ): Promise<string> {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload(overrides));

    expect(res.status).toBe(201);
    return res.body.data.subscription.id as string;
  }

  function getSubscription(id: string, token: string = tokenA) {
    return request(app)
      .get(`/api/subscriptions/${id}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function patchSubscription(
    id: string,
    body: Record<string, unknown>,
    token: string = tokenA
  ) {
    return request(app)
      .patch(`/api/subscriptions/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function renew(id: string, token: string = tokenA) {
    return request(app)
      .post(`/api/subscriptions/${id}/renew`)
      .set('Authorization', `Bearer ${token}`);
  }

  // ---------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------

  it('creates a subscription with ACTIVE defaults', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload());

    expect(res.status).toBe(201);
    const sub = res.body.data.subscription;
    expect(sub.name).toBe('Streaming');
    expect(sub.amount).toBe(9.99);
    expect(sub.billingCycle).toBe('MONTHLY');
    expect(sub.status).toBe('ACTIVE');
    expect(sub.categoryId).toBeNull();
    expect(sub.category).toBeNull();
    expect(sub.dueState).toBe('UPCOMING');
    expect(toIsoDay(new Date(sub.nextRenewalDate))).toBe(toIsoDay(daysFromToday(10)));
  });

  it('creates a subscription with an expense category summary', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload({ categoryId: expenseCatA }));

    expect(res.status).toBe(201);
    expect(res.body.data.subscription.categoryId).toBe(expenseCatA);
    expect(res.body.data.subscription.category).toMatchObject({
      id: expenseCatA,
      name: 'Subs Expense',
      type: 'EXPENSE',
    });
  });

  it('accepts YEARLY billing cycles', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload({ name: 'Antivirus', billingCycle: 'YEARLY' }));

    expect(res.status).toBe(201);
    expect(res.body.data.subscription.billingCycle).toBe('YEARLY');
  });

  it('lists subscriptions sorted by nextRenewalDate ascending', async () => {
    const later = await createSubscription({
      name: 'Later sub',
      nextRenewalDate: toIsoDay(daysFromToday(30)),
    });
    const sooner = await createSubscription({
      name: 'Sooner sub',
      nextRenewalDate: toIsoDay(daysFromToday(1)),
    });

    const res = await request(app)
      .get('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const subs = res.body.data.subscriptions as { id: string }[];
    expect(subs).toHaveLength(2);
    expect(subs[0].id).toBe(sooner);
    expect(subs[1].id).toBe(later);
  });

  it('updates subscription fields', async () => {
    const id = await createSubscription();

    const res = await patchSubscription(id, {
      name: 'Streaming Plus',
      amount: '14.99',
      status: 'PAUSED',
    }).expect(200);

    const sub = res.body.data.subscription;
    expect(sub.name).toBe('Streaming Plus');
    expect(sub.amount).toBe(14.99);
    expect(sub.status).toBe('PAUSED');
    expect(sub.billingCycle).toBe('MONTHLY');
  });

  it('clears the category with categoryId: null', async () => {
    const id = await createSubscription({ categoryId: expenseCatA });

    const res = await patchSubscription(id, { categoryId: null }).expect(200);

    expect(res.body.data.subscription.categoryId).toBeNull();
    expect(res.body.data.subscription.category).toBeNull();
  });

  it('deletes a subscription and subsequent access returns 404', async () => {
    const id = await createSubscription();

    await request(app)
      .delete(`/api/subscriptions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    await getSubscription(id).expect(404);
    await request(app)
      .delete(`/api/subscriptions/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('rejects unauthenticated requests with 401', async () => {
    await request(app).get('/api/subscriptions').expect(401);
    await request(app).post('/api/subscriptions').send(createSubscriptionPayload()).expect(401);
    await request(app).post('/api/subscriptions/some-id/renew').expect(401);
  });

  // ---------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------

  it('rejects a missing name', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload({ name: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors['body.name']).toBeDefined();
  });

  it('rejects a non-positive amount', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload({ amount: '0' }));

    expect(res.status).toBe(400);
    expect(res.body.errors['body.amount']).toBeDefined();
  });

  it('rejects an invalid billing cycle', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload({ billingCycle: 'BIWEEKLY' }));

    expect(res.status).toBe(400);
    expect(res.body.errors['body.billingCycle']).toBeDefined();
  });

  it('rejects an invalid status', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload({ status: 'SOMETHING' }));

    expect(res.status).toBe(400);
    expect(res.body.errors['body.status']).toBeDefined();
  });

  it('rejects an invalid renewal date', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload({ nextRenewalDate: 'nope' }));

    expect(res.status).toBe(400);
    expect(res.body.errors['body.nextRenewalDate']).toBeDefined();
  });

  it('rejects unknown body fields (strict schema)', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload({ bogus: 1 }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors['body']).toBeDefined();
  });

  it('rejects an update with an empty body', async () => {
    const id = await createSubscription();

    const res = await patchSubscription(id, {}).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an income category with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload({ categoryId: incomeCatA }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors['body.categoryId']).toBeDefined();
  });

  it("rejects another user's category with 404", async () => {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(createSubscriptionPayload({ categoryId: expenseCatB }));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('rejects an invalid list query filter', async () => {
    const res = await request(app)
      .get('/api/subscriptions?status=NOT_A_STATUS')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(400);
    expect(res.body.errors['query.status']).toBeDefined();
  });

  // ---------------------------------------------------------------
  // Ownership
  // --------------------------------------------------------------

  it("denies another user's subscription with 404 SUBSCRIPTION_NOT_FOUND", async () => {
    const id = await createSubscription();

    const getRes = await getSubscription(id, tokenB).expect(404);
    expect(getRes.body.error.code).toBe('SUBSCRIPTION_NOT_FOUND');

    const patchRes = await patchSubscription(id, { name: 'Hijacked' }, tokenB).expect(404);
    expect(patchRes.body.error.code).toBe('SUBSCRIPTION_NOT_FOUND');

    const renewRes = await renew(id, tokenB).expect(404);
    expect(renewRes.body.error.code).toBe('SUBSCRIPTION_NOT_FOUND');

    await request(app)
      .delete(`/api/subscriptions/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    const untouched = await getSubscription(id).expect(200);
    expect(untouched.body.data.subscription.name).toBe('Streaming');
  });

  // ---------------------------------------------------------------
  // Filters
  // --------------------------------------------------------------

  it('filters subscriptions by status', async () => {
    await createSubscription({ name: 'Active sub' });
    const pausedId = await createSubscription({ name: 'Paused sub' });
    await patchSubscription(pausedId, { status: 'PAUSED' }).expect(200);

    const res = await request(app)
      .get('/api/subscriptions?status=PAUSED')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.subscriptions).toHaveLength(1);
    expect(res.body.data.subscriptions[0].name).toBe('Paused sub');
  });

  it('filters subscriptions by month window on nextRenewalDate', async () => {
    const due = daysFromToday(2);
    await createSubscription({ name: 'In window', nextRenewalDate: toIsoDay(due) });
    await createSubscription({
      name: 'Out of window',
      nextRenewalDate: toIsoDay(daysFromToday(500)),
    });

    const monthKey = toIsoDay(due).slice(0, 7);
    const res = await request(app)
      .get(`/api/subscriptions?month=${monthKey}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.subscriptions).toHaveLength(1);
    expect(res.body.data.subscriptions[0].name).toBe('In window');
  });

  it('filters active subscriptions as exactly ACTIVE', async () => {
    await createSubscription({ name: 'Active sub' });
    const pausedId = await createSubscription({ name: 'Paused sub' });
    await patchSubscription(pausedId, { status: 'PAUSED' }).expect(200);

    const active = await request(app)
      .get('/api/subscriptions?active=true')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(active.body.data.subscriptions).toHaveLength(1);
    expect(active.body.data.subscriptions[0].name).toBe('Active sub');

    const inactive = await request(app)
      .get('/api/subscriptions?active=false')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(inactive.body.data.subscriptions).toHaveLength(1);
    expect(inactive.body.data.subscriptions[0].name).toBe('Paused sub');
  });

  // ---------------------------------------------------------------
  // Due state (derived, never persisted)
  // --------------------------------------------------------------

  it('derives UPCOMING, DUE and OVERDUE from nextRenewalDate', async () => {
    await createSubscription({ name: 'Upcoming', nextRenewalDate: toIsoDay(daysFromToday(4)) });
    await createSubscription({ name: 'Due', nextRenewalDate: toIsoDay(today) });
    await createSubscription({ name: 'Overdue', nextRenewalDate: toIsoDay(daysFromToday(-4)) });

    const res = await request(app)
      .get('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const byName = new Map(
      (
        res.body.data.subscriptions as {
          name: string;
          dueState: string;
          status: string;
        }[]
      ).map((s) => [s.name, s])
    );
    expect(byName.get('Upcoming')?.dueState).toBe('UPCOMING');
    expect(byName.get('Due')?.dueState).toBe('DUE');
    expect(byName.get('Overdue')?.dueState).toBe('OVERDUE');
    expect(byName.get('Overdue')?.status).toBe('ACTIVE');
  });

  it('returns no dueState for PAUSED, CANCELLED and EXPIRED subscriptions', async () => {
    const pausedId = await createSubscription({
      name: 'Paused',
      nextRenewalDate: toIsoDay(daysFromToday(-1)),
      status: 'PAUSED',
    });
    const cancelledId = await createSubscription({
      name: 'Cancelled',
      nextRenewalDate: toIsoDay(daysFromToday(-1)),
      status: 'CANCELLED',
    });
    const expiredId = await createSubscription({
      name: 'Expired',
      nextRenewalDate: toIsoDay(daysFromToday(-1)),
      status: 'EXPIRED',
    });

    expect((await getSubscription(pausedId)).body.data.subscription.dueState).toBeNull();
    expect((await getSubscription(cancelledId)).body.data.subscription.dueState).toBeNull();
    expect((await getSubscription(expiredId)).body.data.subscription.dueState).toBeNull();
  });

  it('does not persist a due-state into the stored status on read', async () => {
    const id = await createSubscription({ nextRenewalDate: toIsoDay(daysFromToday(-4)) });

    await getSubscription(id).expect(200);

    const row = await testPrisma.subscription.findUnique({ where: { id } });
    expect(row?.status).toBe('ACTIVE');
    expect(row?.nextRenewalDate).toEqual(daysFromToday(-4));
  });

  // ---------------------------------------------------------------
  // Renewal
  // --------------------------------------------------------------

  it('renew advances nextRenewalDate forward while keeping status and amount', async () => {
    const id = await createSubscription({
      amount: '9.99',
      billingCycle: 'MONTHLY',
      nextRenewalDate: toIsoDay(today),
    });

    const before = await getSubscription(id).expect(200);
    const beforeDate = new Date(before.body.data.subscription.nextRenewalDate).getTime();

    const res = await renew(id).expect(200);
    const sub = res.body.data.subscription;

    expect(new Date(sub.nextRenewalDate).getTime()).toBeGreaterThan(beforeDate);
    expect(sub.status).toBe('ACTIVE');
    expect(sub.amount).toBe(9.99);
    expect(sub.billingCycle).toBe('MONTHLY');
  });

  it('renew creates no transaction', async () => {
    const id = await createSubscription({ nextRenewalDate: toIsoDay(today) });

    await renew(id).expect(200);

    expect(await testPrisma.transaction.count()).toBe(0);
  });

  it('renew rejects a non-ACTIVE subscription with 400', async () => {
    const id = await createSubscription({ status: 'PAUSED' });

    const res = await renew(id).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors['params.id']).toBeDefined();
  });

  it('renew twice keeps advancing the obligation', async () => {
    const id = await createSubscription({
      billingCycle: 'DAILY',
      nextRenewalDate: toIsoDay(today),
    });

    const first = await renew(id).expect(200);
    const firstDate = new Date(first.body.data.subscription.nextRenewalDate).getTime();

    const second = await renew(id).expect(200);
    const secondDate = new Date(second.body.data.subscription.nextRenewalDate).getTime();

    expect(firstDate).toBeGreaterThan(new Date(today).getTime());
    expect(secondDate).toBeGreaterThan(firstDate);
  });

  // ---------------------------------------------------------------
  // Cross-domain regression
  // --------------------------------------------------------------

  it('an overdue subscription never touches transactions or dashboard totals', async () => {
    await createSubscription({ name: 'Overdue sub', amount: '19.99', nextRenewalDate: toIsoDay(daysFromToday(-10)) });

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
        amount: '19.99',
        transactionDate: startOfUtcDay(new Date()),
      },
    });

    expect(await testPrisma.transaction.count()).toBe(1);

    const summaryAfter = await request(app)
      .get(`/api/dashboard/summary?month=${currentUtcMonth()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(summaryAfter.body.data.monthlySummary.expenses).toBe(19.99);
  });

  it('deleting a subscription leaves other users untouched', async () => {
    const aSub = await createSubscription({ name: 'A sub' });
    const bRes = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${tokenB}`)
      .send(createSubscriptionPayload({ name: 'B sub' }))
      .expect(201);
    const bSub = bRes.body.data.subscription.id;

    await request(app)
      .delete(`/api/subscriptions/${aSub}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    await getSubscription(bSub, tokenB).expect(200);
    await getSubscription(bSub, tokenA).expect(404);
  });
});
