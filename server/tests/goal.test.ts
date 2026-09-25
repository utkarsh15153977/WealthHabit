import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import goalRoutes from '../src/routes/goalRoutes.js';
import { startOfUtcDay } from '../src/utils/date.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = startOfUtcDay(new Date());

function daysFromToday(days: number): Date {
  return new Date(today.getTime() + days * MS_PER_DAY);
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe('Savings Goals API', () => {
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
    app.use('/api/goals', goalRoutes);
    app.use(errorHandler);
  });

  function goalPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Emergency fund',
      targetAmount: '1000.00',
      targetDate: toIsoDay(daysFromToday(60)),
      ...overrides,
    };
  }

  async function createGoal(
    overrides: Record<string, unknown> = {},
    token: string = tokenA
  ): Promise<string> {
    const res = await post('/api/goals', token).send(goalPayload(overrides));
    expect(res.status).toBe(201);
    return res.body.data.goal.id as string;
  }

  async function contribute(
    goalId: string,
    amount: string,
    overrides: Record<string, unknown> = {},
    token: string = tokenA
  ): Promise<string> {
    const res = await post(`/api/goals/${goalId}/contributions`, token).send({
      amount,
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body.data.contribution.id as string;
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
    it('requires a token on every goal endpoint', async () => {
      const goalId = await createGoal();

      expect((await request(app).get('/api/goals')).status).toBe(401);
      expect((await request(app).post('/api/goals').send(goalPayload())).status).toBe(401);
      expect((await request(app).get(`/api/goals/${goalId}`)).status).toBe(401);
      expect((await request(app).patch(`/api/goals/${goalId}`).send({ name: 'x' })).status).toBe(401);
      expect((await request(app).delete(`/api/goals/${goalId}`)).status).toBe(401);
      expect((await request(app).get(`/api/goals/${goalId}/progress`)).status).toBe(401);
      expect(
        (await request(app).get(`/api/goals/${goalId}/contributions`)).status
      ).toBe(401);
      expect(
        (await request(app).post(`/api/goals/${goalId}/contributions`).send({ amount: '10' }))
          .status
      ).toBe(401);
    });
  });

  describe('create goal', () => {
    it('creates a goal with documented defaults', async () => {
      const res = await post('/api/goals').send(goalPayload());

      expect(res.status).toBe(201);
      const goal = res.body.data.goal;
      expect(goal.name).toBe('Emergency fund');
      expect(goal.description).toBeNull();
      expect(goal.targetAmount).toBe(1000);
      expect(goal.currentAmount).toBe(0);
      expect(goal.remainingAmount).toBe(1000);
      expect(goal.progressPercent).toBe(0);
      expect(goal.contributionCount).toBe(0);
      expect(goal.category).toBe('general');
      expect(goal.priority).toBe('MEDIUM');
      expect(goal.status).toBe('ACTIVE');
      expect(goal.monthlyContribution).toBeNull();
      expect(goal.overdue).toBe(false);
      expect(goal.userId).toBeUndefined();
      expect(new Date(goal.targetDate).getTime()).toBe(daysFromToday(60).getTime());
    });

    it('creates a goal with all optional fields', async () => {
      const res = await post('/api/goals').send(
        goalPayload({
          description: 'Save for a rainy day',
          category: 'emergency',
          priority: 'HIGH',
          monthlyContribution: '80.50',
        })
      );

      expect(res.status).toBe(201);
      const goal = res.body.data.goal;
      expect(goal.description).toBe('Save for a rainy day');
      expect(goal.category).toBe('emergency');
      expect(goal.priority).toBe('HIGH');
      expect(goal.monthlyContribution).toBe(80.5);
    });

    it('accepts a numeric target amount', async () => {
      const res = await post('/api/goals').send(goalPayload({ targetAmount: 500 }));

      expect(res.status).toBe(201);
      expect(res.body.data.goal.targetAmount).toBe(500);
    });

    it('rejects a missing name', async () => {
      const res = await post('/api/goals').send(
        goalPayload({ name: undefined })
      );

      expect(res.status).toBe(400);
      expect(res.body.errors['body.name']).toBeDefined();
    });

    it('rejects a missing target amount', async () => {
      const res = await post('/api/goals').send({
        name: 'No amount',
        targetDate: toIsoDay(daysFromToday(10)),
      });

      expect(res.status).toBe(400);
      expect(res.body.errors['body.targetAmount']).toBeDefined();
    });

    it('rejects a missing target date', async () => {
      const res = await post('/api/goals').send({
        name: 'No date',
        targetAmount: '100.00',
      });

      expect(res.status).toBe(400);
      expect(res.body.errors['body.targetDate']).toBeDefined();
    });

    it('rejects zero, negative and malformed amounts', async () => {
      const zero = await post('/api/goals').send(goalPayload({ targetAmount: '0' }));
      expect(zero.status).toBe(400);
      expect(zero.body.errors['body.targetAmount']).toBeDefined();

      const negative = await post('/api/goals').send(
        goalPayload({ targetAmount: '-10.00' })
      );
      expect(negative.status).toBe(400);

      const malformed = await post('/api/goals').send(
        goalPayload({ targetAmount: 'abc' })
      );
      expect(malformed.status).toBe(400);

      const tooManyDecimals = await post('/api/goals').send(
        goalPayload({ targetAmount: '10.123' })
      );
      expect(tooManyDecimals.status).toBe(400);
    });

    it('rejects an amount above the money cap', async () => {
      const res = await post('/api/goals').send(
        goalPayload({ targetAmount: '10000000000000.00' })
      );

      expect(res.status).toBe(400);
      expect(res.body.errors['body.targetAmount']).toBeDefined();
    });

    it('rejects an invalid target date', async () => {
      const res = await post('/api/goals').send(
        goalPayload({ targetDate: 'not-a-date' })
      );

      expect(res.status).toBe(400);
      expect(res.body.errors['body.targetDate']).toBeDefined();
    });

    it('rejects an unknown priority', async () => {
      const res = await post('/api/goals').send(goalPayload({ priority: 'URGENT' }));

      expect(res.status).toBe(400);
      expect(res.body.errors['body.priority']).toBeDefined();
    });

    it('blocks mass assignment of protected fields', async () => {
      const res = await post('/api/goals').send(
        goalPayload({
          status: 'COMPLETED',
          currentAmount: 9999,
          progressPercent: 100,
        })
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body']).toBeDefined();
      expect(await testPrisma.savingsGoal.count()).toBe(0);
    });
  });

  describe('get goal', () => {
    it('returns a goal with derived progress after a contribution', async () => {
      const goalId = await createGoal();
      await contribute(goalId, '250.00');

      const res = await get(`/api/goals/${goalId}`);

      expect(res.status).toBe(200);
      const goal = res.body.data.goal;
      expect(goal.currentAmount).toBe(250);
      expect(goal.remainingAmount).toBe(750);
      expect(goal.progressPercent).toBe(25);
      expect(goal.contributionCount).toBe(1);
    });

    it('returns 404 GOAL_NOT_FOUND for an unknown goal', async () => {
      const res = await get('/api/goals/does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('GOAL_NOT_FOUND');
    });

    it('does not leak another user\'s goal', async () => {
      const goalId = await createGoal();

      const res = await get(`/api/goals/${goalId}`, tokenB);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('GOAL_NOT_FOUND');
    });
  });

  describe('list goals', () => {
    it('returns an empty page with zeroed meta', async () => {
      const res = await get('/api/goals');

      expect(res.status).toBe(200);
      expect(res.body.data.goals).toEqual([]);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(20);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.activeCount).toBe(0);
      expect(res.body.data.totalTargetAmount).toBe(0);
      expect(res.body.data.totalSavedAmount).toBe(0);
      expect(res.body.data.nearestTargetDate).toBeNull();
    });

    it('orders goals by nearest target date first', async () => {
      const far = await createGoal({ name: 'Far', targetDate: toIsoDay(daysFromToday(300)) });
      const near = await createGoal({ name: 'Near', targetDate: toIsoDay(daysFromToday(30)) });
      const middle = await createGoal({ name: 'Middle', targetDate: toIsoDay(daysFromToday(120)) });

      const res = await get('/api/goals');

      const ids = res.body.data.goals.map((goal: { id: string }) => goal.id);
      expect(ids).toEqual([near, middle, far]);
    });

    it('paginates goals', async () => {
      await createGoal({ name: 'One', targetDate: toIsoDay(daysFromToday(10)) });
      await createGoal({ name: 'Two', targetDate: toIsoDay(daysFromToday(20)) });
      await createGoal({ name: 'Three', targetDate: toIsoDay(daysFromToday(30)) });

      const first = await get('/api/goals?page=1&pageSize=2');
      expect(first.body.data.goals).toHaveLength(2);
      expect(first.body.data.total).toBe(3);
      expect(first.body.data.page).toBe(1);

      const second = await get('/api/goals?page=2&pageSize=2');
      expect(second.body.data.goals).toHaveLength(1);
      expect(second.body.data.total).toBe(3);
      expect(second.body.data.page).toBe(2);
    });

    it('rejects an out-of-range page size', async () => {
      const res = await get('/api/goals?pageSize=500');

      expect(res.status).toBe(400);
      expect(res.body.errors['query.pageSize']).toBeDefined();
    });

    it('filters goals by status', async () => {
      const activeId = await createGoal({ name: 'Active goal' });
      const pausedId = await createGoal({ name: 'Paused goal' });
      await patch(`/api/goals/${pausedId}`).send({ status: 'PAUSED' });

      const active = await get('/api/goals?status=ACTIVE');
      expect(active.body.data.goals.map((goal: { id: string }) => goal.id)).toEqual([
        activeId,
      ]);

      const paused = await get('/api/goals?status=PAUSED');
      expect(paused.body.data.goals.map((goal: { id: string }) => goal.id)).toEqual([
        pausedId,
      ]);

      const invalid = await get('/api/goals?status=NOPE');
      expect(invalid.status).toBe(400);
      expect(invalid.body.errors['query.status']).toBeDefined();
    });

    it('aggregates meta across the filtered set', async () => {
      const first = await createGoal({ targetAmount: '1000.00', targetDate: toIsoDay(daysFromToday(45)) });
      const second = await createGoal({ targetAmount: '500.00', targetDate: toIsoDay(daysFromToday(90)) });
      const paused = await createGoal({ targetAmount: '700.00' });
      await patch(`/api/goals/${paused}`).send({ status: 'PAUSED' });
      await contribute(first, '100.00');
      await contribute(second, '200.00');

      const res = await get('/api/goals');

      expect(res.body.data.total).toBe(3);
      expect(res.body.data.activeCount).toBe(2);
      expect(res.body.data.totalTargetAmount).toBe(2200);
      expect(res.body.data.totalSavedAmount).toBe(300);
      expect(new Date(res.body.data.nearestTargetDate).getTime()).toBe(
        daysFromToday(45).getTime()
      );
    });

    it('keeps goals isolated per user', async () => {
      const mine = await createGoal({ name: 'Mine' });
      await createGoal({ name: 'Theirs' }, tokenB);

      const mineList = await get('/api/goals');
      expect(mineList.body.data.total).toBe(1);
      expect(mineList.body.data.goals[0].id).toBe(mine);
      expect(mineList.body.data.goals[0].name).toBe('Mine');

      const theirs = await get('/api/goals', tokenB);
      expect(theirs.body.data.total).toBe(1);
      expect(theirs.body.data.goals[0].name).toBe('Theirs');
    });
  });

  describe('update goal', () => {
    it('updates editable fields', async () => {
      const goalId = await createGoal();

      const res = await patch(`/api/goals/${goalId}`).send({
        name: 'Bigger fund',
        description: 'Six months of expenses',
        targetAmount: '2500.00',
        targetDate: toIsoDay(daysFromToday(120)),
        category: 'safety-net',
        priority: 'LOW',
        monthlyContribution: '200.00',
      });

      expect(res.status).toBe(200);
      const goal = res.body.data.goal;
      expect(goal.name).toBe('Bigger fund');
      expect(goal.description).toBe('Six months of expenses');
      expect(goal.targetAmount).toBe(2500);
      expect(new Date(goal.targetDate).getTime()).toBe(daysFromToday(120).getTime());
      expect(goal.category).toBe('safety-net');
      expect(goal.priority).toBe('LOW');
      expect(goal.monthlyContribution).toBe(200);
    });

    it('clears a nullable description and monthly contribution', async () => {
      const goalId = await createGoal({ description: 'temp', monthlyContribution: '10.00' });

      const res = await patch(`/api/goals/${goalId}`).send({
        description: null,
        monthlyContribution: null,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.goal.description).toBeNull();
      expect(res.body.data.goal.monthlyContribution).toBeNull();
    });

    it('pauses and resumes a goal', async () => {
      const goalId = await createGoal();

      const paused = await patch(`/api/goals/${goalId}`).send({ status: 'PAUSED' });
      expect(paused.body.data.goal.status).toBe('PAUSED');

      const resumed = await patch(`/api/goals/${goalId}`).send({ status: 'ACTIVE' });
      expect(resumed.body.data.goal.status).toBe('ACTIVE');
    });

    it('refuses to set COMPLETED directly', async () => {
      const goalId = await createGoal();

      const res = await patch(`/api/goals/${goalId}`).send({ status: 'COMPLETED' });

      expect(res.status).toBe(400);
      expect(res.body.errors['body.status']).toBeDefined();
      const row = await testPrisma.savingsGoal.findUnique({ where: { id: goalId } });
      expect(row?.status).toBe('ACTIVE');
    });

    it('rejects an empty update body', async () => {
      const goalId = await createGoal();

      const res = await patch(`/api/goals/${goalId}`).send({});

      expect(res.status).toBe(400);
      expect(res.body.errors['body']).toBeDefined();
    });

    it('rejects unknown fields', async () => {
      const goalId = await createGoal();

      const res = await patch(`/api/goals/${goalId}`).send({ userId: 'x' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body']).toBeDefined();
    });

    it('rejects an invalid amount on update', async () => {
      const goalId = await createGoal();

      const res = await patch(`/api/goals/${goalId}`).send({ targetAmount: '-5' });

      expect(res.status).toBe(400);
      expect(res.body.errors['body.targetAmount']).toBeDefined();
    });

    it('does not allow updating another user\'s goal', async () => {
      const goalId = await createGoal();

      const res = await patch(`/api/goals/${goalId}`, tokenB).send({ name: 'Hacked' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('GOAL_NOT_FOUND');
      const row = await testPrisma.savingsGoal.findUnique({ where: { id: goalId } });
      expect(row?.name).toBe('Emergency fund');
    });

    it('un-completes a goal when the target is raised above savings', async () => {
      const goalId = await createGoal({ targetAmount: '100.00' });
      await contribute(goalId, '100.00');

      const completed = await get(`/api/goals/${goalId}`);
      expect(completed.body.data.goal.status).toBe('COMPLETED');

      const raised = await patch(`/api/goals/${goalId}`).send({
        targetAmount: '500.00',
      });

      expect(raised.status).toBe(200);
      expect(raised.body.data.goal.status).toBe('ACTIVE');
      expect(raised.body.data.goal.currentAmount).toBe(100);
      expect(raised.body.data.goal.progressPercent).toBe(20);
    });
  });

  describe('delete goal', () => {
    it('deletes a goal and cascades its contributions', async () => {
      const goalId = await createGoal();
      await contribute(goalId, '100.00');
      await contribute(goalId, '50.00');
      expect(await testPrisma.goalContribution.count()).toBe(2);

      const res = await del(`/api/goals/${goalId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Goal deleted');
      expect(await testPrisma.savingsGoal.count()).toBe(0);
      expect(await testPrisma.goalContribution.count()).toBe(0);
    });

    it('returns 404 on repeated delete', async () => {
      const goalId = await createGoal();
      await del(`/api/goals/${goalId}`);

      const res = await del(`/api/goals/${goalId}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('GOAL_NOT_FOUND');
    });

    it('does not allow deleting another user\'s goal', async () => {
      const goalId = await createGoal();

      const res = await del(`/api/goals/${goalId}`, tokenB);

      expect(res.status).toBe(404);
      expect(await testPrisma.savingsGoal.count()).toBe(1);
    });
  });

  describe('contributions', () => {
    it('creates a contribution defaulting the date to today (UTC)', async () => {
      const goalId = await createGoal();

      const res = await post(`/api/goals/${goalId}/contributions`).send({
        amount: '125.50',
        note: 'Payday transfer',
      });

      expect(res.status).toBe(201);
      const contribution = res.body.data.contribution;
      expect(contribution.amount).toBe(125.5);
      expect(contribution.note).toBe('Payday transfer');
      expect(contribution.goalId).toBe(goalId);
      expect(new Date(contribution.contributionDate).getTime()).toBe(today.getTime());
      expect(contribution.userId).toBeUndefined();
    });

    it('creates a contribution with an explicit date and no note', async () => {
      const goalId = await createGoal();

      const res = await post(`/api/goals/${goalId}/contributions`).send({
        amount: '40',
        contributionDate: toIsoDay(daysFromToday(-10)),
      });

      expect(res.status).toBe(201);
      expect(res.body.data.contribution.amount).toBe(40);
      expect(res.body.data.contribution.note).toBeNull();
      expect(new Date(res.body.data.contribution.contributionDate).getTime()).toBe(
        daysFromToday(-10).getTime()
      );
    });

    it('updates goal and progress responses after a contribution', async () => {
      const goalId = await createGoal({ targetAmount: '400.00' });
      await contribute(goalId, '100.00');

      const goalRes = await get(`/api/goals/${goalId}`);
      expect(goalRes.body.data.goal.currentAmount).toBe(100);
      expect(goalRes.body.data.goal.remainingAmount).toBe(300);
      expect(goalRes.body.data.goal.progressPercent).toBe(25);

      const progressRes = await get(`/api/goals/${goalId}/progress`);
      expect(progressRes.body.data.progress.currentAmount).toBe(100);
      expect(progressRes.body.data.progress.remainingAmount).toBe(300);
      expect(progressRes.body.data.progress.progressPercent).toBe(25);
      expect(progressRes.body.data.progress.contributionCount).toBe(1);
    });

    it('edits a contribution and recalculates progress', async () => {
      const goalId = await createGoal({ targetAmount: '400.00' });
      const contributionId = await contribute(goalId, '100.00');

      const edited = await patch(
        `/api/goals/${goalId}/contributions/${contributionId}`
      ).send({
        amount: '350.00',
        note: 'Corrected',
        contributionDate: toIsoDay(daysFromToday(-3)),
      });

      expect(edited.status).toBe(200);
      expect(edited.body.data.contribution.amount).toBe(350);
      expect(edited.body.data.contribution.note).toBe('Corrected');

      const progress = await get(`/api/goals/${goalId}/progress`);
      expect(progress.body.data.progress.currentAmount).toBe(350);
      expect(progress.body.data.progress.progressPercent).toBe(87.5);
    });

    it('deletes a contribution and recalculates progress', async () => {
      const goalId = await createGoal({ targetAmount: '400.00' });
      const first = await contribute(goalId, '100.00');
      const second = await contribute(goalId, '50.00');

      const res = await del(`/api/goals/${goalId}/contributions/${second}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Contribution deleted');

      const progress = await get(`/api/goals/${goalId}/progress`);
      expect(progress.body.data.progress.currentAmount).toBe(100);
      expect(progress.body.data.progress.contributionCount).toBe(1);
      expect(
        await testPrisma.goalContribution.count({ where: { id: first } })
      ).toBe(1);
    });

    it('lists contributions newest first with pagination', async () => {
      const goalId = await createGoal();
      await contribute(goalId, '10.00', { contributionDate: toIsoDay(daysFromToday(-10)) });
      await contribute(goalId, '20.00', { contributionDate: toIsoDay(daysFromToday(-5)) });
      await contribute(goalId, '30.00');

      const page1 = await get(`/api/goals/${goalId}/contributions?page=1&pageSize=2`);
      expect(page1.status).toBe(200);
      expect(page1.body.data.contributions).toHaveLength(2);
      expect(page1.body.data.total).toBe(3);
      expect(page1.body.data.contributions[0].amount).toBe(30);
      expect(page1.body.data.contributions[1].amount).toBe(20);

      const page2 = await get(`/api/goals/${goalId}/contributions?page=2&pageSize=2`);
      expect(page2.body.data.contributions).toHaveLength(1);
      expect(page2.body.data.contributions[0].amount).toBe(10);
    });

    it('rejects a missing or invalid contribution amount', async () => {
      const goalId = await createGoal();

      const missing = await post(`/api/goals/${goalId}/contributions`).send({
        contributionDate: toIsoDay(today),
      });
      expect(missing.status).toBe(400);
      expect(missing.body.errors['body.amount']).toBeDefined();

      const zero = await post(`/api/goals/${goalId}/contributions`).send({
        amount: '0',
      });
      expect(zero.status).toBe(400);

      const negative = await post(`/api/goals/${goalId}/contributions`).send({
        amount: '-20.00',
      });
      expect(negative.status).toBe(400);
      expect(await testPrisma.goalContribution.count()).toBe(0);
    });

    it('rejects an invalid contribution date or long note', async () => {
      const goalId = await createGoal();

      const badDate = await post(`/api/goals/${goalId}/contributions`).send({
        amount: '10.00',
        contributionDate: 'yesterday-ish',
      });
      expect(badDate.status).toBe(400);
      expect(badDate.body.errors['body.contributionDate']).toBeDefined();

      const longNote = await post(`/api/goals/${goalId}/contributions`).send({
        amount: '10.00',
        note: 'x'.repeat(501),
      });
      expect(longNote.status).toBe(400);
      expect(longNote.body.errors['body.note']).toBeDefined();
    });

    it('rejects unknown fields on contribution create and edit', async () => {
      const goalId = await createGoal();

      const create = await post(`/api/goals/${goalId}/contributions`).send({
        amount: '10.00',
        goalId: 'other',
      });
      expect(create.status).toBe(400);
      expect(create.body.error.code).toBe('VALIDATION_ERROR');
      expect(create.body.errors['body']).toBeDefined();

      const contributionId = await contribute(goalId, '10.00');
      const update = await patch(
        `/api/goals/${goalId}/contributions/${contributionId}`
      ).send({ userId: 'x' });
      expect(update.status).toBe(400);
      expect(update.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an empty contribution update body', async () => {
      const goalId = await createGoal();
      const contributionId = await contribute(goalId, '10.00');

      const res = await patch(
        `/api/goals/${goalId}/contributions/${contributionId}`
      ).send({});

      expect(res.status).toBe(400);
      expect(res.body.errors['body']).toBeDefined();
    });

    it('returns 404 GOAL_NOT_FOUND for unknown or foreign goals', async () => {
      const goalId = await createGoal();

      const unknown = await post('/api/goals/missing-id/contributions').send({
        amount: '10.00',
      });
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('GOAL_NOT_FOUND');

      const foreign = await post(`/api/goals/${goalId}/contributions`, tokenB).send({
        amount: '10.00',
      });
      expect(foreign.status).toBe(404);
      expect(foreign.body.error.code).toBe('GOAL_NOT_FOUND');
      expect(await testPrisma.goalContribution.count()).toBe(0);
    });

    it('returns CONTRIBUTION_NOT_FOUND for unknown or mismatched contributions', async () => {
      const goalId = await createGoal();
      const otherGoalId = await createGoal({ name: 'Second' });
      const contributionId = await contribute(goalId, '10.00');

      const unknown = await patch(
        `/api/goals/${goalId}/contributions/nope`
      ).send({ amount: '20.00' });
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('CONTRIBUTION_NOT_FOUND');

      const mismatched = await patch(
        `/api/goals/${otherGoalId}/contributions/${contributionId}`
      ).send({ amount: '20.00' });
      expect(mismatched.status).toBe(404);
      expect(mismatched.body.error.code).toBe('CONTRIBUTION_NOT_FOUND');

      const deleteUnknown = await del(
        `/api/goals/${goalId}/contributions/nope`
      );
      expect(deleteUnknown.status).toBe(404);
      expect(deleteUnknown.body.error.code).toBe('CONTRIBUTION_NOT_FOUND');
    });

    it('scopes contribution access to the owner', async () => {
      const goalId = await createGoal();
      const contributionId = await contribute(goalId, '10.00');

      const list = await get(`/api/goals/${goalId}/contributions`, tokenB);
      expect(list.status).toBe(404);
      expect(list.body.error.code).toBe('GOAL_NOT_FOUND');

      const update = await patch(
        `/api/goals/${goalId}/contributions/${contributionId}`,
        tokenB
      ).send({ amount: '999.00' });
      expect(update.status).toBe(404);

      const remove = await del(
        `/api/goals/${goalId}/contributions/${contributionId}`,
        tokenB
      );
      expect(remove.status).toBe(404);

      const row = await testPrisma.goalContribution.findUnique({
        where: { id: contributionId },
      });
      expect(Number(row?.amount)).toBe(10);
    });
  });

  describe('progress endpoint', () => {
    it('reports zero progress for a goal with no contributions', async () => {
      const goalId = await createGoal({ targetAmount: '800.00' });

      const res = await get(`/api/goals/${goalId}/progress`);

      expect(res.status).toBe(200);
      const progress = res.body.data.progress;
      expect(progress.goalId).toBe(goalId);
      expect(progress.targetAmount).toBe(800);
      expect(progress.currentAmount).toBe(0);
      expect(progress.remainingAmount).toBe(800);
      expect(progress.progressPercent).toBe(0);
      expect(progress.contributionCount).toBe(0);
      expect(progress.status).toBe('ACTIVE');
      expect(progress.overdue).toBe(false);
    });

    it('sums multiple contributions with decimal precision', async () => {
      const goalId = await createGoal({ targetAmount: '1000.00' });
      await contribute(goalId, '0.10');
      await contribute(goalId, '0.20');
      await contribute(goalId, '33.33');

      const res = await get(`/api/goals/${goalId}/progress`);

      const progress = res.body.data.progress;
      expect(progress.currentAmount).toBe(33.63);
      expect(progress.remainingAmount).toBe(966.37);
      expect(progress.contributionCount).toBe(3);
      expect(progress.progressPercent).toBe(3.36);
    });

    it('reports exactly 100 percent and COMPLETED at the target', async () => {
      const goalId = await createGoal({ targetAmount: '300.00' });
      await contribute(goalId, '100.00');
      await contribute(goalId, '200.00');

      const res = await get(`/api/goals/${goalId}/progress`);

      const progress = res.body.data.progress;
      expect(progress.currentAmount).toBe(300);
      expect(progress.remainingAmount).toBe(0);
      expect(progress.progressPercent).toBe(100);
      expect(progress.status).toBe('COMPLETED');
    });

    it('caps progress at 100 and keeps remaining at zero when over target', async () => {
      const goalId = await createGoal({ targetAmount: '100.00' });
      await contribute(goalId, '75.00');
      await contribute(goalId, '50.00');

      const res = await get(`/api/goals/${goalId}/progress`);

      const progress = res.body.data.progress;
      expect(progress.currentAmount).toBe(125);
      expect(progress.remainingAmount).toBe(0);
      expect(progress.progressPercent).toBe(100);
      expect(progress.status).toBe('COMPLETED');
    });

    it('rounds partial percentages to two decimals', async () => {
      const goalId = await createGoal({ targetAmount: '300.00' });
      await contribute(goalId, '100.00');

      const res = await get(`/api/goals/${goalId}/progress`);
      expect(res.body.data.progress.progressPercent).toBe(33.33);
    });

    it('returns 404 GOAL_NOT_FOUND for unknown and foreign goals', async () => {
      const goalId = await createGoal();

      const unknown = await get('/api/goals/missing/progress');
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('GOAL_NOT_FOUND');

      const foreign = await get(`/api/goals/${goalId}/progress`, tokenB);
      expect(foreign.status).toBe(404);
      expect(foreign.body.error.code).toBe('GOAL_NOT_FOUND');
    });

    it('derives overdue from the target date without persisting it', async () => {
      const overdue = await createGoal({ targetDate: toIsoDay(daysFromToday(-5)) });
      const dueToday = await createGoal({
        name: 'Due today',
        targetDate: toIsoDay(daysFromToday(0)),
      });
      const future = await createGoal({
        name: 'Future',
        targetDate: toIsoDay(daysFromToday(5)),
      });
      const cancelled = await createGoal({
        name: 'Cancelled',
        targetDate: toIsoDay(daysFromToday(-5)),
      });
      await patch(`/api/goals/${cancelled}`).send({ status: 'CANCELLED' });

      const overdueRes = await get(`/api/goals/${overdue}/progress`);
      expect(overdueRes.body.data.progress.overdue).toBe(true);

      const todayRes = await get(`/api/goals/${dueToday}/progress`);
      expect(todayRes.body.data.progress.overdue).toBe(false);

      const futureRes = await get(`/api/goals/${future}/progress`);
      expect(futureRes.body.data.progress.overdue).toBe(false);

      const cancelledRes = await get(`/api/goals/${cancelled}/progress`);
      expect(cancelledRes.body.data.progress.overdue).toBe(false);

      const completedGoal = await createGoal({
        name: 'Late but done',
        targetAmount: '50.00',
        targetDate: toIsoDay(daysFromToday(-5)),
      });
      await contribute(completedGoal, '50.00');
      const completedRes = await get(`/api/goals/${completedGoal}/progress`);
      expect(completedRes.body.data.progress.overdue).toBe(false);

      const rows = await testPrisma.savingsGoal.findMany({
        where: { id: { in: [overdue, dueToday, future, cancelled] } },
      });
      for (const row of rows) {
        expect(row).not.toHaveProperty('overdue');
      }
    });
  });

  describe('status synchronization', () => {
    it('completes an active goal once contributions reach the target', async () => {
      const goalId = await createGoal({ targetAmount: '200.00' });
      await contribute(goalId, '150.00');
      expect((await get(`/api/goals/${goalId}`)).body.data.goal.status).toBe('ACTIVE');

      await contribute(goalId, '50.00');

      expect((await get(`/api/goals/${goalId}`)).body.data.goal.status).toBe('COMPLETED');
      const row = await testPrisma.savingsGoal.findUnique({ where: { id: goalId } });
      expect(row?.status).toBe('COMPLETED');
    });

    it('reopens a completed goal when an edited contribution drops below target', async () => {
      const goalId = await createGoal({ targetAmount: '200.00' });
      const contributionId = await contribute(goalId, '200.00');
      expect((await get(`/api/goals/${goalId}`)).body.data.goal.status).toBe('COMPLETED');

      await patch(`/api/goals/${goalId}/contributions/${contributionId}`).send({
        amount: '100.00',
      });

      expect((await get(`/api/goals/${goalId}`)).body.data.goal.status).toBe('ACTIVE');
    });

    it('reopens a completed goal when a deletion drops below target', async () => {
      const goalId = await createGoal({ targetAmount: '200.00' });
      const first = await contribute(goalId, '120.00');
      await contribute(goalId, '80.00');
      expect((await get(`/api/goals/${goalId}`)).body.data.goal.status).toBe('COMPLETED');

      await del(`/api/goals/${goalId}/contributions/${first}`);

      expect((await get(`/api/goals/${goalId}`)).body.data.goal.status).toBe('ACTIVE');
    });

    it('never overwrites a paused intent', async () => {
      const goalId = await createGoal({ targetAmount: '100.00' });
      await patch(`/api/goals/${goalId}`).send({ status: 'PAUSED' });

      await contribute(goalId, '150.00');

      expect((await get(`/api/goals/${goalId}`)).body.data.goal.status).toBe('PAUSED');
    });

    it('never overwrites a cancelled intent', async () => {
      const goalId = await createGoal({ targetAmount: '100.00' });
      await patch(`/api/goals/${goalId}`).send({ status: 'CANCELLED' });

      await contribute(goalId, '40.00');

      expect((await get(`/api/goals/${goalId}`)).body.data.goal.status).toBe('CANCELLED');
    });

    it('completes on resume when savings already meet the target', async () => {
      const goalId = await createGoal({ targetAmount: '100.00' });
      await contribute(goalId, '100.00');
      await patch(`/api/goals/${goalId}`).send({ status: 'PAUSED' });

      const resumed = await patch(`/api/goals/${goalId}`).send({ status: 'ACTIVE' });

      expect(resumed.body.data.goal.status).toBe('COMPLETED');
    });
  });

  describe('no financial side effects', () => {
    it('creates no transactions, notifications or budgets during a full goal lifecycle', async () => {
      const goalId = await createGoal({ targetAmount: '300.00' });
      const contributionId = await contribute(goalId, '150.00');
      await patch(`/api/goals/${goalId}/contributions/${contributionId}`).send({
        amount: '100.00',
      });
      await get(`/api/goals/${goalId}/progress`);
      await del(`/api/goals/${goalId}/contributions/${contributionId}`);
      await patch(`/api/goals/${goalId}`).send({ status: 'PAUSED' });
      await del(`/api/goals/${goalId}`);

      const [transactions, notifications, budgets, bills, subscriptions, recurring] =
        await Promise.all([
          testPrisma.transaction.count(),
          testPrisma.notification.count(),
          testPrisma.budget.count(),
          testPrisma.bill.count(),
          testPrisma.subscription.count(),
          testPrisma.recurringTransaction.count(),
        ]);

      expect(transactions).toBe(0);
      expect(notifications).toBe(0);
      expect(budgets).toBe(0);
      expect(bills).toBe(0);
      expect(subscriptions).toBe(0);
      expect(recurring).toBe(0);
    });

    it('never writes the legacy stored currentAmount column', async () => {
      const goalId = await createGoal({ targetAmount: '500.00' });
      await contribute(goalId, '175.25');
      await contribute(goalId, '24.75');

      const api = await get(`/api/goals/${goalId}`);
      expect(api.body.data.goal.currentAmount).toBe(200);

      const row = await testPrisma.savingsGoal.findUnique({ where: { id: goalId } });
      expect(Number(row?.currentAmount)).toBe(0);
    });

    it('leaves habit and challenge completion data untouched', async () => {
      const goalId = await createGoal({ targetAmount: '100.00' });
      await contribute(goalId, '100.00');

      const [habitCompletions, participants, challengeHabits] = await Promise.all([
        testPrisma.habitCompletion.count(),
        testPrisma.challengeParticipant.count(),
        testPrisma.challengeHabitRequirement.count(),
      ]);

      expect(habitCompletions).toBe(0);
      expect(participants).toBe(0);
      expect(challengeHabits).toBe(0);
    });
  });

  describe('zeroing isolation', () => {
    it('starts each test with a clean goals table', async () => {
      const count = await testPrisma.savingsGoal.count();
      expect(count).toBe(0);
      expect(userA.id).not.toBe(userB.id);
    });
  });
});
