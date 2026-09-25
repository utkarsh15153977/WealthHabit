import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { Role, AccountStatus } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import challengeRoutes from '../src/routes/challengeRoutes.js';
import habitRoutes from '../src/routes/habitRoutes.js';
import { startOfUtcDay, addUtcDays } from '../src/utils/date.js';
import { eligiblePeriodCount } from '../src/utils/habitPeriod.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = startOfUtcDay(new Date());

function daysFromToday(days: number): Date {
  return new Date(today.getTime() + days * MS_PER_DAY);
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOf(date: Date): Date {
  const day = startOfUtcDay(date);
  return addUtcDays(day, -((day.getUTCDay() + 6) % 7));
}

describe('Challenges API', () => {
  let app: express.Express;
  let admin: { id: string };
  let userB: { id: string };
  let tokenAdmin: string;
  let tokenB: string;

  beforeEach(async () => {
    const a = createTestUser();
    const b = createTestUser();
    const hashA = await hashPassword(a.password);
    const hashB = await hashPassword(b.password);

    const createdAdmin = await testPrisma.user.create({
      data: {
        email: a.email,
        passwordHash: hashA,
        firstName: a.firstName,
        lastName: a.lastName,
        role: Role.ADMIN,
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

    admin = { id: createdAdmin.id };
    userB = { id: createdB.id };
    tokenAdmin = authService.generateAccessToken({
      id: createdAdmin.id,
      role: createdAdmin.role,
    });
    tokenB = authService.generateAccessToken({
      id: createdB.id,
      role: createdB.role,
    });

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/challenges', challengeRoutes);
    app.use('/api/habits', habitRoutes);
    app.use(errorHandler);
  });

  function challengePayload(overrides: Record<string, unknown> = {}) {
    return {
      name: '7-Day Expense Tracking',
      description: 'Track your expenses every day for 7 days.',
      startDate: toIsoDay(daysFromToday(-6)),
      endDate: toIsoDay(daysFromToday(0)),
      requirements: [{ name: 'Track daily expenses', frequency: 'DAILY' }],
      ...overrides,
    };
  }

  async function createChallenge(
    overrides: Record<string, unknown> = {},
    token: string = tokenAdmin
  ): Promise<string> {
    const res = await post('/api/challenges', token).send(
      challengePayload(overrides)
    );
    expect(res.status).toBe(201);
    return res.body.data.challenge.id as string;
  }

  async function createHabit(
    overrides: Record<string, unknown> = {},
    token: string = tokenAdmin
  ): Promise<string> {
    const res = await post('/api/habits', token).send({
      name: 'Track daily expenses',
      frequency: 'DAILY',
      startDate: toIsoDay(daysFromToday(-6)),
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body.data.habit.id as string;
  }

  function post(url: string, token: string = tokenAdmin) {
    return request(app).post(url).set('Authorization', `Bearer ${token}`);
  }

  function get(url: string, token: string = tokenAdmin) {
    return request(app).get(url).set('Authorization', `Bearer ${token}`);
  }

  function patch(url: string, token: string = tokenAdmin) {
    return request(app).patch(url).set('Authorization', `Bearer ${token}`);
  }

  function del(url: string, token: string = tokenAdmin) {
    return request(app).delete(url).set('Authorization', `Bearer ${token}`);
  }

  async function addCompletion(habitId: string, day: Date): Promise<void> {
    await testPrisma.habitCompletion.create({
      data: { habitId, completionDate: startOfUtcDay(day) },
    });
  }

  describe('authentication', () => {
    it('rejects list without an access token', async () => {
      const res = await request(app).get('/api/challenges');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects create without an access token', async () => {
      const res = await request(app)
        .post('/api/challenges')
        .send(challengePayload());
      expect(res.status).toBe(401);
    });

    it('rejects join without an access token', async () => {
      const res = await request(app).post('/api/challenges/abc/join');
      expect(res.status).toBe(401);
    });

    it('rejects leave without an access token', async () => {
      const res = await request(app).delete('/api/challenges/abc/leave');
      expect(res.status).toBe(401);
    });

    it('rejects progress without an access token', async () => {
      const res = await request(app).get('/api/challenges/abc/progress');
      expect(res.status).toBe(401);
    });

    it('rejects habit mapping without an access token', async () => {
      const res = await request(app).post(
        '/api/challenges/abc/requirements/def/habit'
      );
      expect(res.status).toBe(401);
    });

    it('rejects update without an access token', async () => {
      const res = await request(app)
        .patch('/api/challenges/abc')
        .send({ name: 'Renamed' });
      expect(res.status).toBe(401);
    });

    it('rejects delete without an access token', async () => {
      const res = await request(app).delete('/api/challenges/abc');
      expect(res.status).toBe(401);
    });
  });

  describe('CRUD and authorization', () => {
    it('forbids a regular user from creating a challenge', async () => {
      const res = await post('/api/challenges', tokenB).send(
        challengePayload()
      );
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('forbids a regular user from updating a challenge', async () => {
      const id = await createChallenge();
      const res = await patch(`/api/challenges/${id}`, tokenB).send({
        name: 'Renamed',
      });
      expect(res.status).toBe(403);
    });

    it('forbids a regular user from deleting a challenge', async () => {
      const id = await createChallenge();
      const res = await del(`/api/challenges/${id}`, tokenB);
      expect(res.status).toBe(403);
    });

    it('creates a challenge with defaults and requirements', async () => {
      const res = await post('/api/challenges').send(
        challengePayload({ category: 'saving', difficulty: 'HARD', points: 25 })
      );
      expect(res.status).toBe(201);

      const challenge = res.body.data.challenge;
      expect(challenge.name).toBe('7-Day Expense Tracking');
      expect(challenge.type).toBe('HABIT_COMPLETION');
      expect(challenge.category).toBe('saving');
      expect(challenge.difficulty).toBe('HARD');
      expect(challenge.points).toBe(25);
      expect(challenge.isActive).toBe(true);
      expect(challenge.startDate).toBe(
        `${toIsoDay(daysFromToday(-6))}T00:00:00.000Z`
      );
      expect(challenge.endDate).toBe(
        `${toIsoDay(daysFromToday(0))}T00:00:00.000Z`
      );
      expect(challenge.status).toBe('ACTIVE');
      expect(challenge.requirements).toHaveLength(1);
      expect(challenge.requirements[0].frequency).toBe('DAILY');
      expect(challenge.requirements[0].target).toBe(1);
      expect(challenge.participation).toEqual({
        joined: false,
        joinedAt: null,
        status: 'NOT_JOINED',
        progress: null,
      });
    });

    it('applies server-side defaults when optional fields are omitted', async () => {
      const res = await post('/api/challenges').send({
        name: 'Minimal challenge',
        startDate: toIsoDay(daysFromToday(-1)),
        endDate: toIsoDay(daysFromToday(3)),
        requirements: [{ name: 'Daily check-in', frequency: 'DAILY' }],
      });
      expect(res.status).toBe(201);
      const challenge = res.body.data.challenge;
      expect(challenge.category).toBe('general');
      expect(challenge.difficulty).toBe('MEDIUM');
      expect(challenge.points).toBe(0);
      expect(challenge.description).toBe('');
    });

    it('rejects create without a name', async () => {
      const res = await post('/api/challenges').send(
        challengePayload({ name: undefined })
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors['body.name']).toBeDefined();
    });

    it('rejects create when end date is before start date', async () => {
      const res = await post('/api/challenges').send(
        challengePayload({
          startDate: toIsoDay(daysFromToday(5)),
          endDate: toIsoDay(daysFromToday(1)),
        })
      );
      expect(res.status).toBe(400);
      expect(res.body.errors['body.endDate']).toBeDefined();
    });

    it('rejects create without requirements', async () => {
      const res = await post('/api/challenges').send(
        challengePayload({ requirements: [] })
      );
      expect(res.status).toBe(400);
      expect(res.body.errors['body.requirements']).toBeDefined();
    });

    it('rejects create with an invalid requirement frequency', async () => {
      const res = await post('/api/challenges').send(
        challengePayload({
          requirements: [{ name: 'Daily check-in', frequency: 'YEARLY' }],
        })
      );
      expect(res.status).toBe(400);
      expect(res.body.errors['body.requirements.0.frequency']).toBeDefined();
    });

    it('rejects create with an unknown field', async () => {
      const res = await post('/api/challenges').send(
        challengePayload({ bogus: true })
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects create with an unsupported challenge type', async () => {
      const res = await post('/api/challenges').send(
        challengePayload({ type: 'SOCIAL_RACE' })
      );
      expect(res.status).toBe(400);
    });

    it('gets a challenge with participation state', async () => {
      const id = await createChallenge();
      const res = await get(`/api/challenges/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.challenge.id).toBe(id);
      expect(res.body.data.challenge.participation.joined).toBe(false);
      expect(res.body.data.challenge.requirements).toHaveLength(1);
    });

    it('returns 404 for an unknown challenge', async () => {
      const res = await get('/api/challenges/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CHALLENGE_NOT_FOUND');
    });

    it('updates challenge metadata as admin', async () => {
      const id = await createChallenge();
      const res = await patch(`/api/challenges/${id}`).send({
        name: 'Renamed challenge',
        difficulty: 'EASY',
        points: 5,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.challenge.name).toBe('Renamed challenge');
      expect(res.body.data.challenge.difficulty).toBe('EASY');
      expect(res.body.data.challenge.points).toBe(5);
    });

    it('rejects an update that moves the start date past the end date', async () => {
      const id = await createChallenge();
      const res = await patch(`/api/challenges/${id}`).send({
        startDate: toIsoDay(daysFromToday(30)),
      });
      expect(res.status).toBe(400);
      expect(res.body.errors['body.endDate']).toBeDefined();
    });

    it('rejects an empty update body', async () => {
      const id = await createChallenge();
      const res = await patch(`/api/challenges/${id}`).send({});
      expect(res.status).toBe(400);
    });

    it('deletes a challenge as admin', async () => {
      const id = await createChallenge();
      const res = await del(`/api/challenges/${id}`);
      expect(res.status).toBe(200);
      const after = await get(`/api/challenges/${id}`);
      expect(after.status).toBe(404);
    });

    it('cascades participation when a challenge is deleted', async () => {
      const id = await createChallenge();
      const joined = await post(`/api/challenges/${id}/join`, tokenB);
      expect(joined.status).toBe(201);

      await del(`/api/challenges/${id}`);
      const count = await testPrisma.challengeParticipant.count({
        where: { challengeId: id },
      });
      expect(count).toBe(0);
    });
  });

  describe('list filters and status derivation', () => {
    it('derives UPCOMING, ACTIVE, ENDED and deactivated statuses', async () => {
      const upcomingId = await createChallenge({
        name: 'Upcoming',
        startDate: toIsoDay(daysFromToday(3)),
        endDate: toIsoDay(daysFromToday(9)),
      });
      const activeId = await createChallenge({ name: 'Active' });
      const endedId = await createChallenge({
        name: 'Ended',
        startDate: toIsoDay(daysFromToday(-13)),
        endDate: toIsoDay(daysFromToday(-7)),
      });
      const deactivatedId = await createChallenge({ name: 'Deactivated' });
      await patch(`/api/challenges/${deactivatedId}`).send({ isActive: false });

      const res = await get('/api/challenges?pageSize=50');
      expect(res.status).toBe(200);
      const byId = new Map(
        res.body.data.challenges.map((challenge: { id: string }) => [
          challenge.id,
          challenge,
        ])
      );
      expect(byId.get(upcomingId)!.status).toBe('UPCOMING');
      expect(byId.get(activeId)!.status).toBe('ACTIVE');
      expect(byId.get(endedId)!.status).toBe('ENDED');
      expect(byId.get(deactivatedId)!.status).toBe('ENDED');
      expect(res.body.data.activeCount).toBe(1);
    });

    it('filters by status=UPCOMING', async () => {
      await createChallenge({
        name: 'Upcoming',
        startDate: toIsoDay(daysFromToday(3)),
        endDate: toIsoDay(daysFromToday(9)),
      });
      await createChallenge({ name: 'Active' });

      const res = await get('/api/challenges?status=UPCOMING');
      expect(res.status).toBe(200);
      expect(res.body.data.challenges).toHaveLength(1);
      expect(res.body.data.challenges[0].name).toBe('Upcoming');
    });

    it('filters by status=ACTIVE', async () => {
      await createChallenge({
        name: 'Upcoming',
        startDate: toIsoDay(daysFromToday(3)),
        endDate: toIsoDay(daysFromToday(9)),
      });
      await createChallenge({ name: 'Active' });

      const res = await get('/api/challenges?status=ACTIVE');
      expect(res.status).toBe(200);
      expect(res.body.data.challenges).toHaveLength(1);
      expect(res.body.data.challenges[0].name).toBe('Active');
    });

    it('filters by status=ENDED (past or deactivated)', async () => {
      await createChallenge({
        name: 'Ended',
        startDate: toIsoDay(daysFromToday(-13)),
        endDate: toIsoDay(daysFromToday(-7)),
      });
      const deactivatedId = await createChallenge({ name: 'Deactivated' });
      await patch(`/api/challenges/${deactivatedId}`).send({ isActive: false });
      await createChallenge({ name: 'Active' });

      const res = await get('/api/challenges?status=ENDED');
      expect(res.status).toBe(200);
      const names = res.body.data.challenges.map(
        (challenge: { name: string }) => challenge.name
      );
      expect(names.sort()).toEqual(['Deactivated', 'Ended']);
    });

    it('filters by active=true', async () => {
      await createChallenge({ name: 'Active' });
      await createChallenge({
        name: 'Ended',
        startDate: toIsoDay(daysFromToday(-13)),
        endDate: toIsoDay(daysFromToday(-7)),
      });

      const res = await get('/api/challenges?active=true');
      expect(res.status).toBe(200);
      expect(res.body.data.challenges).toHaveLength(1);
      expect(res.body.data.challenges[0].name).toBe('Active');
    });

    it('filters by active=false', async () => {
      await createChallenge({ name: 'Active' });
      await createChallenge({
        name: 'Ended',
        startDate: toIsoDay(daysFromToday(-13)),
        endDate: toIsoDay(daysFromToday(-7)),
      });
      await createChallenge({
        name: 'Upcoming',
        startDate: toIsoDay(daysFromToday(3)),
        endDate: toIsoDay(daysFromToday(9)),
      });

      const res = await get('/api/challenges?active=false');
      expect(res.status).toBe(200);
      const names = res.body.data.challenges.map(
        (challenge: { name: string }) => challenge.name
      );
      expect(names.sort()).toEqual(['Ended', 'Upcoming']);
    });

    it('filters joined=true', async () => {
      const idA = await createChallenge({ name: 'Active' });
      const idB = await createChallenge({ name: 'Active two' });
      await post(`/api/challenges/${idA}/join`, tokenB);

      const res = await get('/api/challenges?joined=true', tokenB);
      expect(res.status).toBe(200);
      expect(res.body.data.challenges).toHaveLength(1);
      expect(res.body.data.challenges[0].id).toBe(idA);
      expect(res.body.data.joinedCount).toBe(1);
    });

    it('paginates the list', async () => {
      await createChallenge({ name: 'One' });
      await createChallenge({ name: 'Two' });
      await createChallenge({ name: 'Three' });

      const res = await get('/api/challenges?page=1&pageSize=2');
      expect(res.status).toBe(200);
      expect(res.body.data.challenges).toHaveLength(2);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(2);
    });

    it('rejects an invalid status filter', async () => {
      const res = await get('/api/challenges?status=WHATEVER');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unknown query parameter', async () => {
      const res = await get('/api/challenges?bogus=1');
      expect(res.status).toBe(400);
    });

    it('rejects page=0', async () => {
      const res = await get('/api/challenges?page=0');
      expect(res.status).toBe(400);
    });
  });

  describe('participation', () => {
    it('joins an active challenge and reports joined state', async () => {
      const id = await createChallenge();
      const res = await post(`/api/challenges/${id}/join`, tokenB);
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        challengeId: id,
        joined: true,
        alreadyJoined: false,
      });

      const detail = await get(`/api/challenges/${id}`, tokenB);
      expect(detail.body.data.challenge.participation.joined).toBe(true);
      expect(detail.body.data.challenge.participation.status).toBe('JOINED');
      expect(detail.body.data.challenge.participation.joinedAt).not.toBeNull();
    });

    it('is idempotent on duplicate join', async () => {
      const id = await createChallenge();
      const first = await post(`/api/challenges/${id}/join`, tokenB);
      expect(first.status).toBe(201);

      const second = await post(`/api/challenges/${id}/join`, tokenB);
      expect(second.status).toBe(200);
      expect(second.body.data.alreadyJoined).toBe(true);

      const count = await testPrisma.challengeParticipant.count({
        where: { challengeId: id },
      });
      expect(count).toBe(1);
    });

    it('never creates duplicate participants under concurrent joins', async () => {
      const id = await createChallenge();

      const [first, second] = await Promise.all([
        post(`/api/challenges/${id}/join`, tokenB),
        post(`/api/challenges/${id}/join`, tokenB),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 201]);

      const alreadyJoinedFlags = [
        first.body.data.alreadyJoined,
        second.body.data.alreadyJoined,
      ].sort();
      expect(alreadyJoinedFlags).toEqual([false, true]);

      const count = await testPrisma.challengeParticipant.count({
        where: { challengeId: id, userId: userB.id },
      });
      expect(count).toBe(1);
    });

    it('rejects joining before the challenge starts', async () => {
      const id = await createChallenge({
        startDate: toIsoDay(daysFromToday(3)),
        endDate: toIsoDay(daysFromToday(9)),
      });
      const res = await post(`/api/challenges/${id}/join`, tokenB);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHALLENGE_NOT_STARTED');
    });

    it('rejects joining after the challenge ends', async () => {
      const id = await createChallenge({
        startDate: toIsoDay(daysFromToday(-13)),
        endDate: toIsoDay(daysFromToday(-7)),
      });
      const res = await post(`/api/challenges/${id}/join`, tokenB);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHALLENGE_ENDED');
    });

    it('rejects joining a deactivated challenge', async () => {
      const id = await createChallenge();
      await patch(`/api/challenges/${id}`).send({ isActive: false });
      const res = await post(`/api/challenges/${id}/join`, tokenB);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHALLENGE_INACTIVE');
    });

    it('returns 404 when joining an unknown challenge', async () => {
      const res = await post('/api/challenges/nope/join', tokenB);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CHALLENGE_NOT_FOUND');
    });

    it('leaves a challenge and is idempotent', async () => {
      const id = await createChallenge();
      await post(`/api/challenges/${id}/join`, tokenB);

      const leave = await del(`/api/challenges/${id}/leave`, tokenB);
      expect(leave.status).toBe(200);
      expect(leave.body.data).toEqual({
        challengeId: id,
        left: true,
        wasJoined: true,
      });

      const detail = await get(`/api/challenges/${id}`, tokenB);
      expect(detail.body.data.challenge.participation.joined).toBe(false);

      const again = await del(`/api/challenges/${id}/leave`, tokenB);
      expect(again.status).toBe(200);
      expect(again.body.data.wasJoined).toBe(false);

      const count = await testPrisma.challengeParticipant.count({
        where: { challengeId: id },
      });
      expect(count).toBe(0);
    });

    it('leaving does not delete habit completions or the challenge', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      await addCompletion(habitId, daysFromToday(-2));
      await post(`/api/challenges/${id}/join`, tokenB);

      await del(`/api/challenges/${id}/leave`, tokenB);

      const completions = await testPrisma.habitCompletion.count({
        where: { habitId },
      });
      expect(completions).toBe(1);
      const challenge = await testPrisma.challenge.findUnique({
        where: { id },
      });
      expect(challenge).not.toBeNull();
    });
  });

  describe('participant isolation (IDOR)', () => {
    it('never exposes another user participation state', async () => {
      const id = await createChallenge();
      await post(`/api/challenges/${id}/join`, tokenAdmin);

      const detail = await get(`/api/challenges/${id}`, tokenB);
      expect(detail.status).toBe(200);
      expect(detail.body.data.challenge.participation.joined).toBe(false);
      expect(detail.body.data.challenge.participation.status).toBe('NOT_JOINED');
    });

    it('rejects progress for a user who has not joined', async () => {
      const id = await createChallenge();
      await post(`/api/challenges/${id}/join`, tokenAdmin);

      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHALLENGE_NOT_JOINED');
    });

    it('never removes another user participation on leave', async () => {
      const id = await createChallenge();
      await post(`/api/challenges/${id}/join`, tokenAdmin);

      const leave = await del(`/api/challenges/${id}/leave`, tokenB);
      expect(leave.status).toBe(200);
      expect(leave.body.data.wasJoined).toBe(false);

      const count = await testPrisma.challengeParticipant.count({
        where: { challengeId: id },
      });
      expect(count).toBe(1);
    });

    it('cannot map another user habit', async () => {
      const id = await createChallenge();
      const adminHabitId = await createHabit({}, tokenAdmin);
      const requirementId = await getRequirementId(id);

      await post(`/api/challenges/${id}/join`, tokenB);
      const res = await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId: adminHabitId });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CHALLENGE_HABIT_NOT_FOUND');
    });

    it('rejects mapping without joining first', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      const requirementId = await getRequirementId(id);

      const res = await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHALLENGE_NOT_JOINED');
    });

    it('returns 404 for an unknown requirement', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      await post(`/api/challenges/${id}/join`, tokenB);

      const res = await post(
        `/api/challenges/${id}/requirements/unknown-requirement/habit`,
        tokenB
      ).send({ habitId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CHALLENGE_NOT_FOUND');
    });

    it('two users can independently join the same challenge', async () => {
      const id = await createChallenge();
      const first = await post(`/api/challenges/${id}/join`, tokenAdmin);
      const second = await post(`/api/challenges/${id}/join`, tokenB);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);

      const count = await testPrisma.challengeParticipant.count({
        where: { challengeId: id },
      });
      expect(count).toBe(2);
    });
  });

  async function getRequirementId(challengeId: string): Promise<string> {
    const res = await get(`/api/challenges/${challengeId}`);
    expect(res.status).toBe(200);
    return res.body.data.challenge.requirements[0].id as string;
  }

  describe('habit mapping validation', () => {
    it('maps a matching active habit', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);

      const res = await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });
      expect(res.status).toBe(200);
      expect(res.body.data.mapping).toEqual({ requirementId, habitId });
    });

    it('is idempotent when mapping the same habit twice', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);

      const url = `/api/challenges/${id}/requirements/${requirementId}/habit`;
      const first = await post(url, tokenB).send({ habitId });
      const second = await post(url, tokenB).send({ habitId });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const count = await testPrisma.challengeParticipantHabit.count({
        where: { habitId },
      });
      expect(count).toBe(1);
    });

    it('rejects a habit whose frequency does not match the requirement', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({ frequency: 'WEEKLY' }, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);

      const res = await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHALLENGE_HABIT_MISMATCH');
    });

    it('rejects an inactive habit', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      await patch(`/api/habits/${habitId}`, tokenB).send({ isActive: false });
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);

      const res = await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHALLENGE_HABIT_MISMATCH');
    });

    it('rejects a habit that does not overlap the challenge dates', async () => {
      const id = await createChallenge();
      const habitId = await createHabit(
        { startDate: toIsoDay(daysFromToday(30)) },
        tokenB
      );
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);

      const res = await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHALLENGE_HABIT_MISMATCH');
    });

    it('rejects an unknown habit id', async () => {
      const id = await createChallenge();
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);

      const res = await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId: 'missing-habit' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CHALLENGE_HABIT_NOT_FOUND');
    });

    it('rejects a mapping body with an unknown field', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);

      const res = await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId, userId: userB.id });
      expect(res.status).toBe(400);
    });

    it('replaces the previous mapping when a different habit is linked', async () => {
      const id = await createChallenge();
      const habitOne = await createHabit({ name: 'Habit one' }, tokenB);
      const habitTwo = await createHabit({ name: 'Habit two' }, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);

      const url = `/api/challenges/${id}/requirements/${requirementId}/habit`;
      await post(url, tokenB).send({ habitId: habitOne });
      const res = await post(url, tokenB).send({ habitId: habitTwo });
      expect(res.status).toBe(200);
      expect(res.body.data.mapping.habitId).toBe(habitTwo);

      const progress = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(progress.body.data.requirements[0].habitId).toBe(habitTwo);
    });
  });

  describe('progress: daily', () => {
    it('reports zero progress for a joined but unmapped participant', async () => {
      const id = await createChallenge();
      await post(`/api/challenges/${id}/join`, tokenB);

      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.status).toBe(200);
      expect(res.body.data.joined).toBe(true);
      expect(res.body.data.eligiblePeriods).toBe(7);
      expect(res.body.data.completedPeriods).toBe(0);
      expect(res.body.data.completionRate).toBe(0);
      expect(res.body.data.completed).toBe(false);
      expect(res.body.data.requirements[0].mapped).toBe(false);
    });

    it('computes partial daily progress (6/7 = 85.71%)', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });

      // completion outside the challenge window must never count
      await addCompletion(habitId, daysFromToday(-10));
      for (const offset of [-6, -5, -4, -3, -2, 0]) {
        await addCompletion(habitId, daysFromToday(offset));
      }

      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.status).toBe(200);
      expect(res.body.data.eligiblePeriods).toBe(7);
      expect(res.body.data.completedPeriods).toBe(6);
      expect(res.body.data.completionRate).toBe(85.71);
      expect(res.body.data.completed).toBe(false);
      expect(res.body.data.status).toBe('JOINED');
      expect(res.body.data.requirements[0].mapped).toBe(true);
      expect(res.body.data.requirements[0].completedPeriods).toBe(6);
    });

    it('derives completion at 100%', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });

      for (const offset of [-6, -5, -4, -3, -2, -1, 0]) {
        await addCompletion(habitId, daysFromToday(offset));
      }

      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.body.data.completedPeriods).toBe(7);
      expect(res.body.data.eligiblePeriods).toBe(7);
      expect(res.body.data.completionRate).toBe(100);
      expect(res.body.data.completed).toBe(true);
      expect(res.body.data.status).toBe('COMPLETED');
    });
  });

  describe('progress: weekly', () => {
    it('counts Monday-based weeks over the challenge window', async () => {
      const challengeStart = addUtcDays(mondayOf(today), -14);
      const challengeEnd = addUtcDays(mondayOf(today), 6);
      const id = await createChallenge({
        startDate: toIsoDay(challengeStart),
        endDate: toIsoDay(challengeEnd),
        requirements: [{ name: 'Weekly review', frequency: 'WEEKLY' }],
      });
      const habitId = await createHabit(
        { frequency: 'WEEKLY', startDate: toIsoDay(challengeStart) },
        tokenB
      );
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });

      // completion before the challenge starts must not count
      await addCompletion(habitId, addUtcDays(challengeStart, -1));
      await addCompletion(habitId, challengeStart);
      await addCompletion(habitId, addUtcDays(challengeStart, 7));

      const expectedEligible = eligiblePeriodCount(
        'WEEKLY',
        challengeStart,
        challengeEnd,
        today
      );
      expect(expectedEligible).toBe(3);

      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.body.data.eligiblePeriods).toBe(3);
      expect(res.body.data.completedPeriods).toBe(2);
      expect(res.body.data.completionRate).toBe(66.67);
    });

    it('reaches 100% when every week is completed', async () => {
      const challengeStart = addUtcDays(mondayOf(today), -14);
      const challengeEnd = addUtcDays(mondayOf(today), 6);
      const id = await createChallenge({
        startDate: toIsoDay(challengeStart),
        endDate: toIsoDay(challengeEnd),
        requirements: [{ name: 'Weekly review', frequency: 'WEEKLY' }],
      });
      const habitId = await createHabit(
        { frequency: 'WEEKLY', startDate: toIsoDay(challengeStart) },
        tokenB
      );
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });

      await addCompletion(habitId, challengeStart);
      await addCompletion(habitId, addUtcDays(challengeStart, 7));
      await addCompletion(habitId, addUtcDays(challengeStart, 14));

      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.body.data.completedPeriods).toBe(3);
      expect(res.body.data.completionRate).toBe(100);
      expect(res.body.data.completed).toBe(true);
    });
  });

  describe('progress: monthly', () => {
    it('counts UTC months over the challenge window', async () => {
      const firstOfPrevMonth = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)
      );
      const id = await createChallenge({
        startDate: toIsoDay(firstOfPrevMonth),
        endDate: toIsoDay(today),
        requirements: [{ name: 'Monthly savings', frequency: 'MONTHLY' }],
      });
      const habitId = await createHabit(
        { frequency: 'MONTHLY', startDate: toIsoDay(firstOfPrevMonth) },
        tokenB
      );
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });

      // completion in the month before the challenge starts must not count
      await addCompletion(habitId, addUtcDays(firstOfPrevMonth, -1));
      await addCompletion(habitId, firstOfPrevMonth);
      await addCompletion(habitId, today);

      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.body.data.eligiblePeriods).toBe(2);
      expect(res.body.data.completedPeriods).toBe(2);
      expect(res.body.data.completionRate).toBe(100);
    });
  });

  describe('progress: boundaries', () => {
    it('honours the habit end date inside the challenge window', async () => {
      const id = await createChallenge();
      const habitId = await createHabit(
        { startDate: toIsoDay(daysFromToday(-6)), endDate: toIsoDay(daysFromToday(-3)) },
        tokenB
      );
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });

      for (const offset of [-6, -5, -4]) {
        await addCompletion(habitId, daysFromToday(offset));
      }
      await addCompletion(habitId, daysFromToday(0));
      await addCompletion(habitId, daysFromToday(-10));

      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.body.data.eligiblePeriods).toBe(4);
      expect(res.body.data.completedPeriods).toBe(3);
      expect(res.body.data.completionRate).toBe(75);
    });

    it('reports zero eligible periods after the challenge start moves to the future', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });

      await patch(`/api/challenges/${id}`).send({
        startDate: toIsoDay(daysFromToday(1)),
        endDate: toIsoDay(daysFromToday(7)),
      });

      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.status).toBe(200);
      expect(res.body.data.eligiblePeriods).toBe(0);
      expect(res.body.data.completionRate).toBe(0);
      expect(res.body.data.completed).toBe(false);
      expect(res.body.data.status).toBe('JOINED');
    });

    it('keeps historical progress visible after the challenge ends', async () => {
      const id = await createChallenge({
        startDate: toIsoDay(daysFromToday(-6)),
        endDate: toIsoDay(daysFromToday(2)),
      });
      const habitId = await createHabit({}, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });

      for (const offset of [-6, -5, -4, -3, -2, -1, 0]) {
        await addCompletion(habitId, daysFromToday(offset));
      }

      await patch(`/api/challenges/${id}`).send({
        endDate: toIsoDay(daysFromToday(-1)),
      });

      const detail = await get(`/api/challenges/${id}`, tokenB);
      expect(detail.body.data.challenge.status).toBe('ENDED');
      expect(detail.body.data.challenge.participation.joined).toBe(true);

      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.status).toBe(200);
      expect(res.body.data.eligiblePeriods).toBe(6);
      expect(res.body.data.completedPeriods).toBe(6);
      expect(res.body.data.completionRate).toBe(100);
      expect(res.body.data.completed).toBe(true);
    });

    it('still computes progress for a deactivated challenge', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });
      await addCompletion(habitId, daysFromToday(-6));

      await patch(`/api/challenges/${id}`).send({ isActive: false });

      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.status).toBe(200);
      expect(res.body.data.eligiblePeriods).toBe(7);
      expect(res.body.data.completedPeriods).toBe(1);
    });

    it('supports a single-day challenge', async () => {
      const id = await createChallenge({
        startDate: toIsoDay(today),
        endDate: toIsoDay(today),
      });
      const habitId = await createHabit(
        { startDate: toIsoDay(today) },
        tokenB
      );
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });

      let res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.body.data.eligiblePeriods).toBe(1);
      expect(res.body.data.completionRate).toBe(0);

      await addCompletion(habitId, today);
      res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.body.data.completionRate).toBe(100);
      expect(res.body.data.completed).toBe(true);
    });
  });

  describe('informational-only operations', () => {
    it('creates no financial records when joining, mapping and progressing', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });
      await addCompletion(habitId, daysFromToday(-6));
      await get(`/api/challenges/${id}/progress`, tokenB);
      await del(`/api/challenges/${id}/leave`, tokenB);

      const [transactions, budgets, bills, subscriptions, recurring, goals] =
        await Promise.all([
          testPrisma.transaction.count(),
          testPrisma.budget.count(),
          testPrisma.bill.count(),
          testPrisma.subscription.count(),
          testPrisma.recurringTransaction.count(),
          testPrisma.savingsGoal.count(),
        ]);

      expect(transactions).toBe(0);
      expect(budgets).toBe(0);
      expect(bills).toBe(0);
      expect(subscriptions).toBe(0);
      expect(recurring).toBe(0);
      expect(goals).toBe(0);
    });

    it('does not mutate habit completions when completing a challenge', async () => {
      const id = await createChallenge();
      const habitId = await createHabit({}, tokenB);
      const requirementId = await getRequirementId(id);
      await post(`/api/challenges/${id}/join`, tokenB);
      await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenB
      ).send({ habitId });
      for (const offset of [-6, -5, -4, -3, -2, -1, 0]) {
        await addCompletion(habitId, daysFromToday(offset));
      }

      const before = await testPrisma.habitCompletion.count({ where: { habitId } });
      const res = await get(`/api/challenges/${id}/progress`, tokenB);
      expect(res.body.data.completed).toBe(true);
      const after = await testPrisma.habitCompletion.count({ where: { habitId } });
      expect(after).toBe(before);
      expect(before).toBe(7);
    });

    it('keeps existing habit completion behavior intact', async () => {
      const habitId = await createHabit({}, tokenB);
      const complete = await post(`/api/habits/${habitId}/complete`, tokenB);
      expect(complete.status).toBe(201);
      expect(complete.body.data.alreadyCompleted).toBe(false);

      const duplicate = await post(`/api/habits/${habitId}/complete`, tokenB);
      expect(duplicate.status).toBe(200);

      const progress = await get(`/api/habits/${habitId}/progress`, tokenB);
      expect(progress.status).toBe(200);
      expect(progress.body.data.totalCompletions).toBe(1);
      expect(progress.body.data.streak.current).toBe(1);
    });
  });
});
