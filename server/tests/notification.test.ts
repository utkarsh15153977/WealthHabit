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
  BillStatus,
  Frequency,
  SubscriptionStatus,
  NotificationType,
} from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';
import budgetRoutes from '../src/routes/budgetRoutes.js';
import billRoutes from '../src/routes/billRoutes.js';
import subscriptionRoutes from '../src/routes/subscriptionRoutes.js';
import recurringTransactionRoutes from '../src/routes/recurringTransactionRoutes.js';
import notificationRoutes from '../src/routes/notificationRoutes.js';
import { startOfUtcDay, currentUtcMonth } from '../src/utils/date.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = startOfUtcDay(new Date());

function daysFromToday(days: number): Date {
  return new Date(today.getTime() + days * MS_PER_DAY);
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function previousMonthKey(): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return toIsoDay(d).slice(0, 7);
}

describe('Notifications API', () => {
  let app: express.Express;
  let userA: { id: string };
  let userB: { id: string };
  let tokenA: string;
  let tokenB: string;
  let expenseCatA1: string;
  let expenseCatA2: string;
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
    userB = { id: createdB.id };
    tokenA = authService.generateAccessToken({ id: createdA.id, role: createdA.role });
    tokenB = authService.generateAccessToken({ id: createdB.id, role: createdB.role });

    const catA1 = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Groceries', type: CategoryType.EXPENSE },
    });
    const catA2 = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Transport', type: CategoryType.EXPENSE },
    });
    const catIncomeA = await testPrisma.category.create({
      data: { userId: createdA.id, name: 'Salary', type: CategoryType.INCOME },
    });
    const catB = await testPrisma.category.create({
      data: { userId: createdB.id, name: 'B Expenses', type: CategoryType.EXPENSE },
    });

    expenseCatA1 = catA1.id;
    expenseCatA2 = catA2.id;
    incomeCatA = catIncomeA.id;
    expenseCatB = catB.id;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/categories', categoryRoutes);
    app.use('/api/transactions', transactionRoutes);
    app.use('/api/budgets', budgetRoutes);
    app.use('/api/bills', billRoutes);
    app.use('/api/subscriptions', subscriptionRoutes);
    app.use('/api/recurring-transactions', recurringTransactionRoutes);
    app.use('/api/notifications', notificationRoutes);
    app.use(errorHandler);
  });

  function generate(token: string = tokenA) {
    return request(app).post('/api/notifications/generate').set('Authorization', `Bearer ${token}`);
  }

  function list(query: string = '', token: string = tokenA) {
    return request(app)
      .get(`/api/notifications${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function unreadCount(token: string = tokenA) {
    return request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`);
  }

  function markRead(id: string, token: string = tokenA) {
    return request(app)
      .patch(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${token}`);
  }

  function markAllRead(token: string = tokenA) {
    return request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);
  }

  function remove(id: string, token: string = tokenA) {
    return request(app)
      .delete(`/api/notifications/${id}`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function seedNotification(
    userId: string,
    overrides: Record<string, unknown> = {}
  ) {
    return testPrisma.notification.create({
      data: {
        userId,
        type: NotificationType.BILL_UPCOMING,
        title: 'Seed notification',
        message: 'Seed message',
        dedupKey: `seed-${Math.random().toString(36).slice(2)}`,
        ...overrides,
      },
    });
  }

  async function createBudget(
    overrides: Record<string, unknown> = {},
    token: string = tokenA
  ): Promise<string> {
    const res = await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Food',
        amount: '100.00',
        month: currentUtcMonth(),
        ...overrides,
      });

    expect(res.status).toBe(201);
    return res.body.data.budget.id as string;
  }

  async function createExpense(
    amount: string,
    categoryId: string = expenseCatA1,
    date: Date = today,
    token: string = tokenA
  ): Promise<void> {
    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        categoryId,
        type: 'EXPENSE',
        amount,
        transactionDate: toIsoDay(date),
      });

    expect(res.status).toBe(201);
  }

  async function createBill(
    overrides: Record<string, unknown> = {},
    token: string = tokenA
  ): Promise<string> {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Internet',
        amount: '49.99',
        frequency: 'MONTHLY',
        dueDate: toIsoDay(daysFromToday(2)),
        ...overrides,
      });

    expect(res.status).toBe(201);
    return res.body.data.bill.id as string;
  }

  async function createSubscription(
    overrides: Record<string, unknown> = {},
    token: string = tokenA
  ): Promise<string> {
    const res = await request(app)
      .post('/api/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Netflix',
        amount: '15.99',
        billingCycle: 'MONTHLY',
        nextRenewalDate: toIsoDay(daysFromToday(2)),
        ...overrides,
      });

    expect(res.status).toBe(201);
    return res.body.data.subscription.id as string;
  }

  async function createRecurring(
    overrides: Record<string, unknown> = {},
    token: string = tokenA
  ): Promise<string> {
    const res = await request(app)
      .post('/api/recurring-transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Gym membership',
        categoryId: expenseCatA1,
        type: 'EXPENSE',
        amount: '30.00',
        frequency: 'MONTHLY',
        startDate: toIsoDay(daysFromToday(2)),
        ...overrides,
      });

    expect(res.status).toBe(201);
    return res.body.data.recurringTransaction.id as string;
  }

  // ---------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------

  it('rejects list without an access token', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects generate without an access token', async () => {
    const res = await request(app).post('/api/notifications/generate');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects mark read without an access token', async () => {
    const res = await request(app).patch('/api/notifications/abc/read');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // ---------------------------------------------------------------
  // Ownership isolation
  // --------------------------------------------------------------

  it('scopes list results to the authenticated user', async () => {
    const notification = await seedNotification(userA.id);

    const aList = await list();
    expect(aList.status).toBe(200);
    expect(aList.body.data.items.map((item: { id: string }) => item.id)).toContain(
      notification.id
    );

    const bList = await list('', tokenB);
    expect(bList.status).toBe(200);
    expect(bList.body.data.items).toHaveLength(0);
    expect(bList.body.data.unreadCount).toBe(0);
  });

  it("returns 404 when marking another user's notification read", async () => {
    const notification = await seedNotification(userA.id);

    const res = await markRead(notification.id, tokenB);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');

    const unchanged = await testPrisma.notification.findUnique({
      where: { id: notification.id },
    });
    expect(unchanged?.isRead).toBe(false);
  });

  it("returns 404 when deleting another user's notification", async () => {
    const notification = await seedNotification(userA.id);

    const res = await remove(notification.id, tokenB);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');

    const stillThere = await testPrisma.notification.findUnique({
      where: { id: notification.id },
    });
    expect(stillThere).not.toBeNull();
  });

  // ---------------------------------------------------------------
  // Read state
  // --------------------------------------------------------------

  it('reports unread count for unread notifications only', async () => {
    await seedNotification(userA.id);
    const read = await seedNotification(userA.id);
    await testPrisma.notification.update({
      where: { id: read.id },
      data: { isRead: true, readAt: new Date() },
    });
    await seedNotification(userA.id);

    const res = await unreadCount();
    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(2);
  });

  it('marks a notification read and sets readAt', async () => {
    const notification = await seedNotification(userA.id);

    const res = await markRead(notification.id);
    expect(res.status).toBe(200);
    expect(res.body.data.notification.isRead).toBe(true);
    expect(res.body.data.notification.readAt).not.toBeNull();

    const stored = await testPrisma.notification.findUnique({
      where: { id: notification.id },
    });
    expect(stored?.isRead).toBe(true);
    expect(stored?.readAt).not.toBeNull();
  });

  it('keeps the original readAt when marking read twice', async () => {
    const notification = await seedNotification(userA.id);

    const first = await markRead(notification.id);
    expect(first.status).toBe(200);
    const readAt = new Date(first.body.data.notification.readAt);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await markRead(notification.id);
    expect(second.status).toBe(200);
    expect(second.body.data.notification.isRead).toBe(true);
    expect(new Date(second.body.data.notification.readAt).getTime()).toBe(
      readAt.getTime()
    );
  });

  it('marks all read for the current user only', async () => {
    await seedNotification(userA.id);
    await seedNotification(userA.id);
    const bNotification = await seedNotification(userB.id);

    const res = await markAllRead();
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(2);

    const countRes = await unreadCount();
    expect(countRes.body.data.unreadCount).toBe(0);

    const bStored = await testPrisma.notification.findUnique({
      where: { id: bNotification.id },
    });
    expect(bStored?.isRead).toBe(false);
  });

  it('filters the list to unread notifications only', async () => {
    await seedNotification(userA.id, { title: 'Unread one' });
    const read = await seedNotification(userA.id, { title: 'Read one' });
    await testPrisma.notification.update({
      where: { id: read.id },
      data: { isRead: true, readAt: new Date() },
    });

    const res = await list('?unreadOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].title).toBe('Unread one');
    expect(res.body.data.unreadCount).toBe(1);
  });

  // ---------------------------------------------------------------
  // Budget thresholds
  // --------------------------------------------------------------

  it('creates no budget notification below the 80% threshold', async () => {
    await createBudget();
    await createExpense('79.99');

    const res = await generate();
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(0);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications).toHaveLength(0);
  });

  it('creates a budget notification at exactly 80% spending', async () => {
    await createBudget();
    await createExpense('80.00');

    const res = await generate();
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe(NotificationType.BUDGET_THRESHOLD);
    expect(notifications[0].title).toContain('reached 80%');
    expect(notifications[0].message).toContain('80%');
  });

  it('creates only the 100% budget notification when fully spent', async () => {
    await createBudget();
    await createExpense('100.00');

    const res = await generate();
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('reached 100%');
    expect(notifications[0].title).not.toContain('80%');
  });

  it('does not duplicate budget notifications on repeated generation', async () => {
    await createBudget();
    await createExpense('85.00');

    const first = await generate();
    expect(first.body.data.created).toBe(1);

    const second = await generate();
    expect(second.body.data.created).toBe(0);

    const count = await testPrisma.notification.count({
      where: { userId: userA.id },
    });
    expect(count).toBe(1);
  });

  it('ignores budgets from other months', async () => {
    await createBudget({ month: previousMonthKey(), name: 'Old budget' });
    await createExpense('100.00', expenseCatA1, daysFromToday(-40));

    const res = await generate();
    expect(res.body.data.created).toBe(0);

    const count = await testPrisma.notification.count({
      where: { userId: userA.id },
    });
    expect(count).toBe(0);
  });

  it('ignores income transactions when computing budget progress', async () => {
    await createBudget();

    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        categoryId: incomeCatA,
        type: 'INCOME',
        amount: '500.00',
        transactionDate: toIsoDay(today),
      });
    expect(res.status).toBe(201);

    const gen = await generate();
    expect(gen.body.data.created).toBe(0);
  });

  it('does not count spending from a different category than the budget', async () => {
    await createBudget({ categoryId: expenseCatA1 });
    await createExpense('100.00', expenseCatA2);

    const res = await generate();
    expect(res.body.data.created).toBe(0);
  });

  it('counts spending from the budget category for a category budget', async () => {
    await createBudget({ categoryId: expenseCatA1 });
    await createExpense('90.00', expenseCatA1);

    const res = await generate();
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications[0].title).toContain('Food budget reached 80%');
  });

  it('counts spending from any category for an uncategorized budget', async () => {
    await createBudget();
    await createExpense('95.00', expenseCatA2);

    const res = await generate();
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications[0].title).toContain('reached 80%');
  });

  // ---------------------------------------------------------------
  // Bills
  // --------------------------------------------------------------

  it('creates an upcoming bill notification when the bill is due today', async () => {
    await createBill({ dueDate: toIsoDay(today) });

    const res = await generate();
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications[0].type).toBe(NotificationType.BILL_UPCOMING);
    expect(notifications[0].title).toContain('due today');
  });

  it('creates an upcoming bill notification at the 3-day boundary', async () => {
    await createBill({ dueDate: toIsoDay(daysFromToday(3)) });

    const res = await generate();
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications[0].title).toContain('in 3 days');
  });

  it('ignores bills due more than 3 days out', async () => {
    await createBill({ dueDate: toIsoDay(daysFromToday(4)) });

    const res = await generate();
    expect(res.body.data.created).toBe(0);
  });

  it('creates an overdue notification for a past-due pending bill', async () => {
    await createBill({ dueDate: toIsoDay(daysFromToday(-1)) });

    const res = await generate();
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications[0].type).toBe(NotificationType.BILL_OVERDUE);
    expect(notifications[0].title).toContain('overdue');
  });

  it('ignores cancelled bills due today', async () => {
    await createBill({ dueDate: toIsoDay(today), status: 'CANCELLED' });

    const res = await generate();
    expect(res.body.data.created).toBe(0);
  });

  it('ignores paid bills that are past due', async () => {
    await createBill({ dueDate: toIsoDay(daysFromToday(-2)), status: 'PAID' });

    const res = await generate();
    expect(res.body.data.created).toBe(0);
  });

  it('does not duplicate bill, subscription or recurring notifications', async () => {
    await createBill({ dueDate: toIsoDay(daysFromToday(1)) });
    await createSubscription({ nextRenewalDate: toIsoDay(daysFromToday(1)) });
    await createRecurring({ startDate: toIsoDay(daysFromToday(1)) });

    const first = await generate();
    expect(first.body.data.created).toBe(3);

    const second = await generate();
    expect(second.body.data.created).toBe(0);

    const count = await testPrisma.notification.count({
      where: { userId: userA.id },
    });
    expect(count).toBe(3);
  });

  // ---------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------

  it('creates an upcoming subscription notification at the 3-day boundary', async () => {
    await createSubscription({ nextRenewalDate: toIsoDay(daysFromToday(3)) });

    const res = await generate();
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications[0].type).toBe(NotificationType.SUBSCRIPTION_UPCOMING);
    expect(notifications[0].title).toContain('in 3 days');
  });

  it('creates a subscription notification when renewing today', async () => {
    await createSubscription({ nextRenewalDate: toIsoDay(today) });

    const res = await generate();
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications[0].title).toContain('renews today');
  });

  it('ignores paused subscriptions', async () => {
    await createSubscription({
      nextRenewalDate: toIsoDay(daysFromToday(1)),
      status: 'PAUSED',
    });

    const res = await generate();
    expect(res.body.data.created).toBe(0);
  });

  it('ignores subscriptions renewing more than 3 days out', async () => {
    await createSubscription({ nextRenewalDate: toIsoDay(daysFromToday(4)) });

    const res = await generate();
    expect(res.body.data.created).toBe(0);
  });

  // ---------------------------------------------------------------
  // Recurring transactions
  // --------------------------------------------------------------

  it('creates a recurring notification for an occurrence due tomorrow', async () => {
    await createRecurring({ startDate: toIsoDay(daysFromToday(1)) });

    const res = await generate();
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications[0].type).toBe(
      NotificationType.RECURRING_TRANSACTION_UPCOMING
    );
    expect(notifications[0].title).toContain('due tomorrow');
  });

  it('creates a recurring notification for an occurrence due today', async () => {
    await createRecurring({ startDate: toIsoDay(today) });

    const res = await generate();
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications[0].title).toContain('due today');
  });

  it('ignores inactive recurring transactions', async () => {
    await createRecurring({
      startDate: toIsoDay(daysFromToday(1)),
      isActive: false,
    });

    const res = await generate();
    expect(res.body.data.created).toBe(0);
  });

  it('ignores recurring transactions due more than 1 day out', async () => {
    await createRecurring({ startDate: toIsoDay(daysFromToday(2)) });

    const res = await generate();
    expect(res.body.data.created).toBe(0);
  });

  // ---------------------------------------------------------------
  // Date boundaries
  // --------------------------------------------------------------

  it('treats a due date with a time component as its UTC day', async () => {
    await testPrisma.bill.create({
      data: {
        userId: userA.id,
        name: 'Time-bound bill',
        amount: '10.00',
        frequency: Frequency.MONTHLY,
        dueDate: new Date(daysFromToday(1).getTime() + 23 * 60 * 60 * 1000),
        nextDueDate: new Date(daysFromToday(1).getTime() + 23 * 60 * 60 * 1000),
        status: BillStatus.PENDING,
      },
    });

    const res = await generate();
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications[0].type).toBe(NotificationType.BILL_UPCOMING);
    expect(notifications[0].title).toContain('due tomorrow');
  });

  it('treats an overdue bill with an evening time as overdue, not due today', async () => {
    const yesterdayEvening = new Date(
      daysFromToday(-1).getTime() + 23 * 60 * 60 * 1000
    );
    await testPrisma.bill.create({
      data: {
        userId: userA.id,
        name: 'Evening bill',
        amount: '10.00',
        frequency: Frequency.MONTHLY,
        dueDate: yesterdayEvening,
        nextDueDate: yesterdayEvening,
        status: BillStatus.OVERDUE,
      },
    });

    const res = await generate();
    expect(res.body.data.created).toBe(1);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: userA.id },
    });
    expect(notifications[0].type).toBe(NotificationType.BILL_OVERDUE);
  });

  // ---------------------------------------------------------------
  // API validation
  // --------------------------------------------------------------

  it('rejects page values below 1', async () => {
    const res = await list('?page=0');
    expect(res.status).toBe(400);
    expect(res.body.errors['query.page']).toBeDefined();
  });

  it('rejects non-numeric page values', async () => {
    const res = await list('?page=abc');
    expect(res.status).toBe(400);
    expect(res.body.errors['query.page']).toBeDefined();
  });

  it('rejects pageSize above 50', async () => {
    const res = await list('?pageSize=51');
    expect(res.status).toBe(400);
    expect(res.body.errors['query.pageSize']).toBeDefined();
  });

  it('accepts pageSize of exactly 50', async () => {
    const res = await list('?pageSize=50');
    expect(res.status).toBe(200);
    expect(res.body.data.pageSize).toBe(50);
  });

  it('rejects invalid unreadOnly values', async () => {
    const res = await list('?unreadOnly=maybe');
    expect(res.status).toBe(400);
    expect(res.body.errors['query.unreadOnly']).toBeDefined();
  });

  it('rejects unknown query parameters', async () => {
    const res = await list('?foo=1');
    expect(res.status).toBe(400);
    expect(res.body.errors['query']).toBeDefined();
  });

  it('returns 404 for a notification id that does not exist', async () => {
    const res = await markRead('does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
  });

  // ---------------------------------------------------------------
  // Pagination & response shape
  // --------------------------------------------------------------

  it('paginates the list with total and unread count', async () => {
    for (let i = 0; i < 25; i += 1) {
      await seedNotification(userA.id, { title: `Notification ${i}` });
    }

    const res = await list('?page=2&pageSize=20');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(5);
    expect(res.body.data.page).toBe(2);
    expect(res.body.data.pageSize).toBe(20);
    expect(res.body.data.total).toBe(25);
    expect(res.body.data.unreadCount).toBe(25);
  });

  it('returns the created count from generation', async () => {
    await createBill({ dueDate: toIsoDay(today) });
    await createSubscription({ nextRenewalDate: toIsoDay(today) });

    const res = await generate();
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(2);
  });

  // ---------------------------------------------------------------
  // Informational-only regression
  // --------------------------------------------------------------

  it('never creates transactions while generating notifications', async () => {
    await createBudget();
    await createExpense('100.00');
    await createBill({ dueDate: toIsoDay(today) });
    await createRecurring({ startDate: toIsoDay(daysFromToday(1)) });

    const before = await testPrisma.transaction.count({ where: { userId: userA.id } });

    const res = await generate();
    expect(res.body.data.created).toBeGreaterThan(0);

    const after = await testPrisma.transaction.count({ where: { userId: userA.id } });
    expect(after).toBe(before);
  });

  it('never modifies obligations while generating notifications', async () => {
    const billId = await createBill({ dueDate: toIsoDay(daysFromToday(1)) });
    const subscriptionId = await createSubscription({
      nextRenewalDate: toIsoDay(daysFromToday(1)),
    });
    const recurringId = await createRecurring({
      startDate: toIsoDay(daysFromToday(1)),
    });

    const billBefore = await testPrisma.bill.findUniqueOrThrow({
      where: { id: billId },
    });
    const subscriptionBefore = await testPrisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    const recurringBefore = await testPrisma.recurringTransaction.findUniqueOrThrow({
      where: { id: recurringId },
    });

    const res = await generate();
    expect(res.body.data.created).toBe(3);

    const billAfter = await testPrisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(billAfter.status).toBe(billBefore.status);
    expect(billAfter.nextDueDate.getTime()).toBe(billBefore.nextDueDate.getTime());

    const subscriptionAfter = await testPrisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    expect(subscriptionAfter.status).toBe(subscriptionBefore.status);
    expect(subscriptionAfter.nextRenewalDate.getTime()).toBe(
      subscriptionBefore.nextRenewalDate.getTime()
    );

    const recurringAfter = await testPrisma.recurringTransaction.findUniqueOrThrow({
      where: { id: recurringId },
    });
    expect(recurringAfter.isActive).toBe(recurringBefore.isActive);
    expect(recurringAfter.nextOccurrenceDate.getTime()).toBe(
      recurringBefore.nextOccurrenceDate.getTime()
    );
  });
});
