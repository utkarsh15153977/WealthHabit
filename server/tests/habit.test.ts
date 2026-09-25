import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus, NotificationType } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import habitRoutes from '../src/routes/habitRoutes.js';
import notificationRoutes from '../src/routes/notificationRoutes.js';
import { startOfUtcDay, addUtcDays } from '../src/utils/date.js';
import {
  eligiblePeriodCount,
  habitPeriodAnchor,
  habitPeriodKey,
} from '../src/utils/habitPeriod.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = startOfUtcDay(new Date());

function daysFromToday(days: number): Date {
  return new Date(today.getTime() + days * MS_PER_DAY);
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe('Habits API', () => {
  let app: express.Express;
  let userA: { id: string };
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
    app.use('/api/habits', habitRoutes);
    app.use('/api/notifications', notificationRoutes);
    app.use(errorHandler);
  });

  function createHabitPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Track daily expenses',
      frequency: 'DAILY',
      startDate: toIsoDay(today),
      ...overrides,
    };
  }

  async function createHabit(
    overrides: Record<string, unknown> = {},
    token: string = tokenA
  ): Promise<string> {
    const res = await request(app)
      .post('/api/habits')
      .set('Authorization', `Bearer ${token}`)
      .send(createHabitPayload(overrides));
    expect(res.status).toBe(201);
    return res.body.data.habit.id as string;
  }

  function post(url: string, token: string = tokenA) {
    return request(app).post(url).set('Authorization', `Bearer ${token}`);
  }

  function get(url: string, token: string = tokenA) {
    return request(app).get(url).set('Authorization', `Bearer ${token}`);
  }

  function patch(url: string, token: string = tokenA) {
    return request(app).patch(url).set('Authorization', `Bearer ${token}`);
  }

  function del(url: string, token: string = tokenA) {
    return request(app).delete(url).set('Authorization', `Bearer ${token}`);
  }

  describe('authentication', () => {
    it('rejects list without an access token', async () => {
      const res = await request(app).get('/api/habits');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects create without an access token', async () => {
      const res = await request(app)
        .post('/api/habits')
        .send(createHabitPayload());
      expect(res.status).toBe(401);
    });

    it('rejects complete without an access token', async () => {
      const res = await request(app).post('/api/habits/abc/complete');
      expect(res.status).toBe(401);
    });

    it('rejects progress without an access token', async () => {
      const res = await request(app).get('/api/habits/abc/progress');
      expect(res.status).toBe(401);
    });
  });

  describe('create habit', () => {
    it('creates a daily habit with default values', async () => {
      const res = await post('/api/habits').send(createHabitPayload());

      expect(res.status).toBe(201);
      const habit = res.body.data.habit;
      expect(habit.name).toBe('Track daily expenses');
      expect(habit.frequency).toBe('DAILY');
      expect(habit.isActive).toBe(true);
      expect(habit.description).toBeNull();
      expect(habit.target).toBeNull();
      expect(habit.unit).toBeNull();
      expect(habit.endDate).toBeNull();
      expect(new Date(habit.startDate).getTime()).toBe(today.getTime());
      expect(habit.userId).toBeUndefined();
    });

    it('creates a habit with target, unit and description', async () => {
      const res = await post('/api/habits').send(
        createHabitPayload({
          description: 'Log every rupee spent',
          target: '500.00',
          unit: 'INR',
        })
      );

      expect(res.status).toBe(201);
      expect(res.body.data.habit.target).toBe(500);
      expect(res.body.data.habit.unit).toBe('INR');
      expect(res.body.data.habit.description).toBe('Log every rupee spent');
    });

    it('creates weekly and monthly habits', async () => {
      const weekly = await post('/api/habits').send(
        createHabitPayload({ name: 'Weekly review', frequency: 'WEEKLY' })
      );
      const monthly = await post('/api/habits').send(
        createHabitPayload({ name: 'Monthly budget', frequency: 'MONTHLY' })
      );

      expect(weekly.status).toBe(201);
      expect(weekly.body.data.habit.frequency).toBe('WEEKLY');
      expect(monthly.status).toBe(201);
      expect(monthly.body.data.habit.frequency).toBe('MONTHLY');
    });

    it('rejects a missing name', async () => {
      const res = await post('/api/habits').send({ frequency: 'DAILY', startDate: toIsoDay(today) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body.name']).toBeDefined();
    });

    it('rejects an empty name', async () => {
      const res = await post('/api/habits').send(createHabitPayload({ name: '   ' }));
      expect(res.status).toBe(400);
      expect(res.body.errors['body.name']).toBeDefined();
    });

    it('rejects a name longer than 100 characters', async () => {
      const res = await post('/api/habits').send(createHabitPayload({ name: 'x'.repeat(101) }));
      expect(res.status).toBe(400);
      expect(res.body.errors['body.name']).toBeDefined();
    });

    it('rejects a description longer than 500 characters', async () => {
      const res = await post('/api/habits').send(
        createHabitPayload({ description: 'x'.repeat(501) })
      );
      expect(res.status).toBe(400);
      expect(res.body.errors['body.description']).toBeDefined();
    });

    it('rejects YEARLY frequency', async () => {
      const res = await post('/api/habits').send(createHabitPayload({ frequency: 'YEARLY' }));
      expect(res.status).toBe(400);
      expect(res.body.errors['body.frequency']).toBeDefined();
    });

    it('rejects an unknown frequency value', async () => {
      const res = await post('/api/habits').send(createHabitPayload({ frequency: 'HOURLY' }));
      expect(res.status).toBe(400);
    });

    it('rejects unknown fields', async () => {
      const res = await post('/api/habits').send(createHabitPayload({ streak: 5 }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an invalid target amount', async () => {
      const res = await post('/api/habits').send(createHabitPayload({ target: 'not-a-number' }));
      expect(res.status).toBe(400);
      expect(res.body.errors['body.target']).toBeDefined();
    });

    it('rejects a negative target amount', async () => {
      const res = await post('/api/habits').send(createHabitPayload({ target: '-10' }));
      expect(res.status).toBe(400);
    });

    it('rejects a unit longer than 30 characters', async () => {
      const res = await post('/api/habits').send(createHabitPayload({ unit: 'x'.repeat(31) }));
      expect(res.status).toBe(400);
      expect(res.body.errors['body.unit']).toBeDefined();
    });

    it('rejects an invalid start date', async () => {
      const res = await post('/api/habits').send(createHabitPayload({ startDate: 'not-a-date' }));
      expect(res.status).toBe(400);
      expect(res.body.errors['body.startDate']).toBeDefined();
    });

    it('rejects an endDate before startDate', async () => {
      const res = await post('/api/habits').send(
        createHabitPayload({
          startDate: toIsoDay(daysFromToday(10)),
          endDate: toIsoDay(daysFromToday(5)),
        })
      );
      expect(res.status).toBe(400);
      expect(res.body.errors['body.endDate']).toBeDefined();
    });

    it('accepts an endDate equal to startDate', async () => {
      const res = await post('/api/habits').send(
        createHabitPayload({ endDate: toIsoDay(today) })
      );
      expect(res.status).toBe(201);
    });
  });

  describe('list habits', () => {
    it('returns an empty page for a new user', async () => {
      const res = await get('/api/habits');
      expect(res.status).toBe(200);
      expect(res.body.data.habits).toEqual([]);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(20);
    });

    it('lists habits sorted active first then newest first', async () => {
      const first = await createHabit({ name: 'First' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await createHabit({ name: 'Second' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const third = await createHabit({ name: 'Third' });

      await patch(`/api/habits/${third}`).send({ isActive: false });
      await patch(`/api/habits/${first}`).send({ isActive: false });

      const res = await get('/api/habits');
      expect(res.status).toBe(200);
      const ids = res.body.data.habits.map((habit: { id: string }) => habit.id);
      expect(ids[0]).toBe(second);
      expect(ids).toHaveLength(3);
      expect(res.body.data.total).toBe(3);
    });

    it('paginates habits', async () => {
      for (let i = 0; i < 3; i += 1) {
        await createHabit({ name: `Habit ${i}` });
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const res = await get('/api/habits?page=1&pageSize=2');
      expect(res.status).toBe(200);
      expect(res.body.data.habits).toHaveLength(2);
      expect(res.body.data.total).toBe(3);

      const page2 = await get('/api/habits?page=2&pageSize=2');
      expect(page2.body.data.habits).toHaveLength(1);
      expect(page2.body.data.page).toBe(2);
    });

    it('returns an empty page beyond the last page', async () => {
      await createHabit();
      const res = await get('/api/habits?page=5');
      expect(res.status).toBe(200);
      expect(res.body.data.habits).toEqual([]);
      expect(res.body.data.total).toBe(1);
    });

    it('rejects page=0', async () => {
      const res = await get('/api/habits?page=0');
      expect(res.status).toBe(400);
      expect(res.body.errors['query.page']).toBeDefined();
    });

    it('rejects pageSize above 50', async () => {
      const res = await get('/api/habits?pageSize=51');
      expect(res.status).toBe(400);
      expect(res.body.errors['query.pageSize']).toBeDefined();
    });

    it('rejects unknown query parameters', async () => {
      const res = await get('/api/habits?foo=bar');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('filters by active=true and active=false', async () => {
      const activeId = await createHabit({ name: 'Active one' });
      const inactiveId = await createHabit({ name: 'Inactive one' });
      await patch(`/api/habits/${inactiveId}`).send({ isActive: false });

      const active = await get('/api/habits?active=true');
      expect(active.body.data.habits.map((habit: { id: string }) => habit.id)).toEqual([activeId]);

      const inactive = await get('/api/habits?active=false');
      expect(inactive.body.data.habits.map((habit: { id: string }) => habit.id)).toEqual([inactiveId]);
    });

    it('filters by frequency', async () => {
      const dailyId = await createHabit({ name: 'Daily one' });
      await createHabit({ name: 'Weekly one', frequency: 'WEEKLY' });

      const res = await get('/api/habits?frequency=DAILY');
      expect(res.status).toBe(200);
      expect(res.body.data.habits.map((habit: { id: string }) => habit.id)).toEqual([dailyId]);
    });

    it('omits progress unless includeProgress=true', async () => {
      const id = await createHabit();

      const plain = await get('/api/habits');
      expect(plain.body.data.habits[0].progress).toBeUndefined();

      const withProgress = await get('/api/habits?includeProgress=true');
      expect(withProgress.status).toBe(200);
      const progress = withProgress.body.data.habits[0].progress;
      expect(progress.habitId).toBe(id);
      expect(progress.totalCompletions).toBe(0);
      expect(progress.completionRate).toBe(0);
      expect(progress.currentPeriod.completed).toBe(false);
      expect(progress.active).toBe(true);
    });

    it('computes batch progress for multiple habits at once', async () => {
      const doneId = await createHabit({ name: 'Done today' });
      const pendingId = await createHabit({ name: 'Still pending' });

      await post(`/api/habits/${doneId}/complete`);

      const res = await get('/api/habits?includeProgress=true&pageSize=50');
      const byId = new Map(
        res.body.data.habits.map((habit: { id: string; progress: { currentPeriod: { completed: boolean } } }) => [
          habit.id,
          habit.progress,
        ])
      );
      expect(byId.get(doneId).currentPeriod.completed).toBe(true);
      expect(byId.get(pendingId).currentPeriod.completed).toBe(false);
    });
  });

  describe('get, update, delete habit', () => {
    it('returns a habit by id', async () => {
      const id = await createHabit();
      const res = await get(`/api/habits/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.habit.id).toBe(id);
    });

    it('returns 404 for another user\'s habit', async () => {
      const id = await createHabit();
      const res = await get(`/api/habits/${id}`, tokenB);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('HABIT_NOT_FOUND');
    });

    it('updates habit fields', async () => {
      const id = await createHabit();
      const res = await patch(`/api/habits/${id}`).send({
        name: 'Updated habit',
        description: 'Now with a description',
        target: '75.50',
        unit: 'times',
        frequency: 'WEEKLY',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.habit.name).toBe('Updated habit');
      expect(res.body.data.habit.description).toBe('Now with a description');
      expect(res.body.data.habit.target).toBe(75.5);
      expect(res.body.data.habit.unit).toBe('times');
      expect(res.body.data.habit.frequency).toBe('WEEKLY');
    });

    it('deactivates and reactivates a habit', async () => {
      const id = await createHabit();

      const off = await patch(`/api/habits/${id}`).send({ isActive: false });
      expect(off.body.data.habit.isActive).toBe(false);

      const on = await patch(`/api/habits/${id}`).send({ isActive: true });
      expect(on.body.data.habit.isActive).toBe(true);
    });

    it('clears nullable fields with null', async () => {
      const id = await createHabit({ description: 'temp', unit: 'days', target: '10' });
      const res = await patch(`/api/habits/${id}`).send({
        description: null,
        unit: null,
        target: null,
      });
      expect(res.body.data.habit.description).toBeNull();
      expect(res.body.data.habit.unit).toBeNull();
      expect(res.body.data.habit.target).toBeNull();
    });

    it('rejects an update with no fields', async () => {
      const id = await createHabit();
      const res = await patch(`/api/habits/${id}`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unknown update fields', async () => {
      const id = await createHabit();
      const res = await patch(`/api/habits/${id}`).send({ color: 'red' });
      expect(res.status).toBe(400);
    });

    it('rejects an update with endDate before startDate', async () => {
      const id = await createHabit({ startDate: toIsoDay(daysFromToday(5)) });
      const res = await patch(`/api/habits/${id}`).send({
        endDate: toIsoDay(today),
      });
      expect(res.status).toBe(400);
      expect(res.body.errors['body.endDate']).toBeDefined();
    });

    it('rejects an endDate before an unchanged startDate', async () => {
      const id = await createHabit({ startDate: toIsoDay(daysFromToday(5)) });
      const res = await patch(`/api/habits/${id}`).send({
        startDate: toIsoDay(daysFromToday(5)),
        endDate: toIsoDay(today),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when updating another user\'s habit', async () => {
      const id = await createHabit();
      const res = await patch(`/api/habits/${id}`, tokenB).send({ name: 'Hacked' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('HABIT_NOT_FOUND');
    });

    it('deletes a habit', async () => {
      const id = await createHabit();
      const res = await del(`/api/habits/${id}`);
      expect(res.status).toBe(200);

      const after = await get(`/api/habits/${id}`);
      expect(after.status).toBe(404);
    });

    it('returns 404 when deleting another user\'s habit', async () => {
      const id = await createHabit();
      const res = await del(`/api/habits/${id}`, tokenB);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('HABIT_NOT_FOUND');

      const stillThere = await get(`/api/habits/${id}`);
      expect(stillThere.status).toBe(200);
    });

    it('deletes completions together with the habit', async () => {
      const id = await createHabit();
      await post(`/api/habits/${id}/complete`);
      expect(
        await testPrisma.habitCompletion.count({ where: { habitId: id } })
      ).toBe(1);

      await del(`/api/habits/${id}`);
      expect(
        await testPrisma.habitCompletion.count({ where: { habitId: id } })
      ).toBe(0);
    });
  });

  describe('complete habit', () => {
    it('completes the current day and returns 201', async () => {
      const id = await createHabit();
      const res = await post(`/api/habits/${id}/complete`);

      expect(res.status).toBe(201);
      expect(res.body.data.alreadyCompleted).toBe(false);
      expect(new Date(res.body.data.completion.completionDate).getTime()).toBe(
        today.getTime()
      );
      expect(res.body.data.completion.period).toBe(
        today.toISOString().slice(0, 10)
      );
    });

    it('is idempotent for the same period (200, single row)', async () => {
      const id = await createHabit();
      const first = await post(`/api/habits/${id}/complete`);
      const second = await post(`/api/habits/${id}/complete`);

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.data.alreadyCompleted).toBe(true);
      expect(
        await testPrisma.habitCompletion.count({ where: { habitId: id } })
      ).toBe(1);
    });

    it('resolves concurrent duplicate completions at the database level', async () => {
      const id = await createHabit();
      const [r1, r2] = await Promise.all([
        post(`/api/habits/${id}/complete`),
        post(`/api/habits/${id}/complete`),
      ]);

      expect([r1.status, r2.status].sort()).toEqual([200, 201]);
      expect(
        await testPrisma.habitCompletion.count({ where: { habitId: id } })
      ).toBe(1);
    });

    it('anchors a weekly completion to Monday of the ISO week', async () => {
      const id = await createHabit({
        frequency: 'WEEKLY',
        startDate: toIsoDay(addUtcDays(today, -14)),
      });
      const res = await post(`/api/habits/${id}/complete`);

      expect(res.status).toBe(201);
      const expected = habitPeriodAnchor('WEEKLY', today);
      expect(new Date(res.body.data.completion.completionDate).getTime()).toBe(
        expected.getTime()
      );
      expect(res.body.data.completion.period).toBe(
        habitPeriodKey('WEEKLY', today)
      );
    });

    it('anchors a monthly completion to the first of the UTC month', async () => {
      const id = await createHabit({
        frequency: 'MONTHLY',
        startDate: toIsoDay(addUtcDays(today, -60)),
      });
      const res = await post(`/api/habits/${id}/complete`);

      expect(res.status).toBe(201);
      const expected = habitPeriodAnchor('MONTHLY', today);
      expect(new Date(res.body.data.completion.completionDate).getTime()).toBe(
        expected.getTime()
      );
      expect(res.body.data.completion.period).toBe(
        habitPeriodKey('MONTHLY', today)
      );
    });

    it('rejects completing an inactive habit', async () => {
      const id = await createHabit();
      await patch(`/api/habits/${id}`).send({ isActive: false });

      const res = await post(`/api/habits/${id}/complete`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('HABIT_INACTIVE');
    });

    it('rejects completing before the startDate', async () => {
      const id = await createHabit({ startDate: toIsoDay(daysFromToday(3)) });
      const res = await post(`/api/habits/${id}/complete`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('HABIT_INVALID_DATE_RANGE');
    });

    it('rejects completing after the endDate', async () => {
      const id = await createHabit({
        startDate: toIsoDay(addUtcDays(today, -10)),
        endDate: toIsoDay(addUtcDays(today, -2)),
      });
      const res = await post(`/api/habits/${id}/complete`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('HABIT_INVALID_DATE_RANGE');
    });

    it('allows completing on the endDate day', async () => {
      const id = await createHabit({
        startDate: toIsoDay(addUtcDays(today, -10)),
        endDate: toIsoDay(today),
      });
      const res = await post(`/api/habits/${id}/complete`);
      expect(res.status).toBe(201);
    });

    it('returns 404 when completing another user\'s habit', async () => {
      const id = await createHabit();
      const res = await post(`/api/habits/${id}/complete`, tokenB);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('HABIT_NOT_FOUND');
      expect(
        await testPrisma.habitCompletion.count({ where: { habitId: id } })
      ).toBe(0);
    });

    it('keeps historical completions unchanged when the frequency changes', async () => {
      const id = await createHabit();
      const first = await post(`/api/habits/${id}/complete`);
      expect(first.status).toBe(201);

      await patch(`/api/habits/${id}`).send({ frequency: 'WEEKLY' });

      const completions = await get(`/api/habits/${id}/completions`);
      expect(completions.body.data.completions).toHaveLength(1);
      expect(
        new Date(completions.body.data.completions[0].completionDate).getTime()
      ).toBe(today.getTime());

      const second = await post(`/api/habits/${id}/complete`);
      const weeklyAnchor = habitPeriodAnchor('WEEKLY', today);
      const expectedStatus =
        weeklyAnchor.getTime() === today.getTime() ? 200 : 201;
      expect(second.status).toBe(expectedStatus);
      expect(
        await testPrisma.habitCompletion.count({ where: { habitId: id } })
      ).toBe(expectedStatus === 201 ? 2 : 1);
    });
  });

  describe('uncomplete habit', () => {
    it('removes the current period completion', async () => {
      const id = await createHabit();
      await post(`/api/habits/${id}/complete`);

      const res = await del(`/api/habits/${id}/complete`);
      expect(res.status).toBe(200);
      expect(res.body.data.removed).toBe(true);
      expect(
        await testPrisma.habitCompletion.count({ where: { habitId: id } })
      ).toBe(0);
    });

    it('is idempotent when nothing is completed', async () => {
      const id = await createHabit();
      const res = await del(`/api/habits/${id}/complete`);
      expect(res.status).toBe(200);
      expect(res.body.data.removed).toBe(false);
    });

    it('allows completing again after uncompleting', async () => {
      const id = await createHabit();
      await post(`/api/habits/${id}/complete`);
      await del(`/api/habits/${id}/complete`);

      const res = await post(`/api/habits/${id}/complete`);
      expect(res.status).toBe(201);
      expect(
        await testPrisma.habitCompletion.count({ where: { habitId: id } })
      ).toBe(1);
    });

    it('returns 404 when uncompleting another user\'s habit', async () => {
      const id = await createHabit();
      await post(`/api/habits/${id}/complete`);

      const res = await del(`/api/habits/${id}/complete`, tokenB);
      expect(res.status).toBe(404);
      expect(
        await testPrisma.habitCompletion.count({ where: { habitId: id } })
      ).toBe(1);
    });
  });

  describe('completion history', () => {
    async function insertCompletions(habitId: string, daysAgo: number[]) {
      for (const offset of daysAgo) {
        await testPrisma.habitCompletion.create({
          data: { habitId, completionDate: daysFromToday(-offset) },
        });
      }
    }

    it('lists completions newest first with pagination', async () => {
      const id = await createHabit();
      await insertCompletions(id, [1, 3, 5]);

      const res = await get(`/api/habits/${id}/completions?page=1&pageSize=2`);
      expect(res.status).toBe(200);
      expect(res.body.data.completions).toHaveLength(2);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.completions[0].completionDate >
        res.body.data.completions[1].completionDate).toBe(true);

      const page2 = await get(`/api/habits/${id}/completions?page=2&pageSize=2`);
      expect(page2.body.data.completions).toHaveLength(1);
    });

    it('rejects pageSize above 50', async () => {
      const id = await createHabit();
      const res = await get(`/api/habits/${id}/completions?pageSize=51`);
      expect(res.status).toBe(400);
      expect(res.body.errors['query.pageSize']).toBeDefined();
    });

    it('rejects page=0', async () => {
      const id = await createHabit();
      const res = await get(`/api/habits/${id}/completions?page=0`);
      expect(res.status).toBe(400);
      expect(res.body.errors['query.page']).toBeDefined();
    });

    it('returns 404 for another user\'s completion history', async () => {
      const id = await createHabit();
      await post(`/api/habits/${id}/complete`);

      const res = await get(`/api/habits/${id}/completions`, tokenB);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('HABIT_NOT_FOUND');
    });

    it('returns 404 after the habit is deleted', async () => {
      const id = await createHabit();
      await del(`/api/habits/${id}`);

      const res = await get(`/api/habits/${id}/completions`);
      expect(res.status).toBe(404);
    });
  });

  describe('progress', () => {
    it('returns zeroed progress before any completion', async () => {
      const id = await createHabit();
      const res = await get(`/api/habits/${id}/progress`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        habitId: id,
        currentPeriod: {
          completed: false,
          period: today.toISOString().slice(0, 10),
        },
        totalCompletions: 0,
        completionRate: 0,
        active: true,
      });
    });

    it('marks the current period completed after completing', async () => {
      const id = await createHabit();
      await post(`/api/habits/${id}/complete`);

      const res = await get(`/api/habits/${id}/progress`);
      expect(res.body.data.currentPeriod.completed).toBe(true);
      expect(res.body.data.totalCompletions).toBe(1);
      expect(res.body.data.completionRate).toBe(100);
      expect(res.body.data.active).toBe(true);
    });

    it('computes completionRate over elapsed eligible periods', async () => {
      const start = addUtcDays(today, -10);
      const id = await createHabit({ startDate: toIsoDay(start) });

      for (const offset of [1, 3, 5, 7, 9]) {
        await testPrisma.habitCompletion.create({
          data: { habitId: id, completionDate: daysFromToday(-offset) },
        });
      }

      const eligible = eligiblePeriodCount('DAILY', start, null, today);
      expect(eligible).toBe(11);

      const res = await get(`/api/habits/${id}/progress`);
      expect(res.body.data.totalCompletions).toBe(5);
      expect(res.body.data.completionRate).toBe(
        Math.round((5 / eligible) * 100 * 100) / 100
      );
    });

    it('caps completionRate at 100 when startDate moved after completions', async () => {
      const id = await createHabit({ startDate: toIsoDay(addUtcDays(today, -20)) });
      for (const offset of [1, 2, 3, 4, 5]) {
        await testPrisma.habitCompletion.create({
          data: { habitId: id, completionDate: daysFromToday(-offset) },
        });
      }

      await patch(`/api/habits/${id}`).send({ startDate: toIsoDay(today) });
      const res = await get(`/api/habits/${id}/progress`);
      expect(res.body.data.completionRate).toBe(100);
    });

    it('keeps history visible with active=false after deactivation', async () => {
      const id = await createHabit();
      await post(`/api/habits/${id}/complete`);
      await patch(`/api/habits/${id}`).send({ isActive: false });

      const res = await get(`/api/habits/${id}/progress`);
      expect(res.body.data.active).toBe(false);
      expect(res.body.data.totalCompletions).toBe(1);
      expect(res.body.data.currentPeriod.completed).toBe(true);
    });

    it('returns 404 for another user\'s progress', async () => {
      const id = await createHabit();
      const res = await get(`/api/habits/${id}/progress`, tokenB);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('HABIT_NOT_FOUND');
    });
  });

  describe('informational only', () => {
    it('creates no transaction, budget, bill, subscription or recurring record', async () => {
      const id = await createHabit({ target: '500', unit: 'INR' });
      await post(`/api/habits/${id}/complete`);
      await post(`/api/habits/${id}/complete`);
      await del(`/api/habits/${id}/complete`);

      expect(await testPrisma.transaction.count({ where: { userId: userA.id } })).toBe(0);
      expect(await testPrisma.budget.count({ where: { userId: userA.id } })).toBe(0);
      expect(await testPrisma.bill.count({ where: { userId: userA.id } })).toBe(0);
      expect(
        await testPrisma.subscription.count({ where: { userId: userA.id } })
      ).toBe(0);
      expect(await testPrisma.recurringTransaction.count({ where: { userId: userA.id } })
      ).toBe(0);
      expect(await testPrisma.savingsGoal.count({ where: { userId: userA.id } })).toBe(0);
    });

    it('does not alter budgets or other aggregate data', async () => {
      const id = await createHabit();
      const budgetBefore = await testPrisma.budget.count();
      const transactionBefore = await testPrisma.transaction.count();

      await post(`/api/habits/${id}/complete`);
      await del(`/api/habits/${id}/complete`);

      expect(await testPrisma.budget.count()).toBe(budgetBefore);
      expect(await testPrisma.transaction.count()).toBe(transactionBefore);
    });
  });

  describe('habit reminder notifications', () => {
    function generate(token: string = tokenA) {
      return request(app)
        .post('/api/notifications/generate')
        .set('Authorization', `Bearer ${token}`);
    }

    it('creates a HABIT_REMINDER for an active daily habit not completed today', async () => {
      const id = await createHabit({ name: 'Drink water' });

      const res = await generate();
      expect(res.status).toBe(200);

      const list = await get('/api/notifications');
      expect(list.body.data.total).toBe(1);
      const item = list.body.data.items[0];
      expect(item.type).toBe(NotificationType.HABIT_REMINDER);
      expect(item.title).toBe('Drink water is waiting for you today');
      expect(item.metadata.habitId).toBe(id);
    });

    it('deduplicates reminders across repeated generations', async () => {
      await createHabit({ name: 'Drink water' });

      const first = await generate();
      const second = await generate();
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const list = await get('/api/notifications');
      expect(list.body.data.total).toBe(1);
    });

    it('skips habits already completed today', async () => {
      const id = await createHabit();
      await post(`/api/habits/${id}/complete`);

      await generate();
      const list = await get('/api/notifications');
      expect(list.body.data.total).toBe(0);
    });

    it('skips inactive habits', async () => {
      const id = await createHabit();
      await patch(`/api/habits/${id}`).send({ isActive: false });

      await generate();
      const list = await get('/api/notifications');
      expect(list.body.data.total).toBe(0);
    });

    it('skips habits outside their date window', async () => {
      await createHabit({ startDate: toIsoDay(daysFromToday(2)) });

      await generate();
      const list = await get('/api/notifications');
      expect(list.body.data.total).toBe(0);
    });

    it('does not create reminders for weekly habits', async () => {
      await createHabit({ frequency: 'WEEKLY' });

      await generate();
      const list = await get('/api/notifications');
      expect(list.body.data.total).toBe(0);
    });
  });
});
