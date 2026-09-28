import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { AccountStatus, Role } from '@prisma/client';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword, authService } from '../src/services/authService.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import challengeRoutes from '../src/routes/challengeRoutes.js';
import habitRoutes from '../src/routes/habitRoutes.js';
import adminChallengeRoutes from '../src/routes/adminChallengeRoutes.js';
import adminAuditLogRoutes from '../src/routes/adminAuditLogRoutes.js';
import { startOfUtcDay } from '../src/utils/date.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = startOfUtcDay(new Date());

function dayOffset(days: number): Date {
  return new Date(today.getTime() + days * MS_PER_DAY);
}

function isoDay(days: number): string {
  return dayOffset(days).toISOString().slice(0, 10);
}

interface TestUser {
  id: string;
  email: string;
  password: string;
}

describe('Admin challenge API', () => {
  let app: express.Express;
  let admin: TestUser;
  let member: TestUser;
  let tokenAdmin: string;
  let tokenUser: string;

  async function createUser(role: Role): Promise<TestUser> {
    const draft = createTestUser();
    const created = await testPrisma.user.create({
      data: {
        email: draft.email,
        passwordHash: await hashPassword(draft.password),
        firstName: draft.firstName,
        lastName: draft.lastName,
        role,
        status: AccountStatus.ACTIVE,
      },
    });
    return { id: created.id, email: created.email, password: draft.password };
  }

  beforeEach(async () => {
    await testPrisma.auditLog.deleteMany();

    admin = await createUser(Role.ADMIN);
    member = await createUser(Role.USER);

    tokenAdmin = authService.generateAccessToken({
      id: admin.id,
      role: Role.ADMIN,
    });
    tokenUser = authService.generateAccessToken({
      id: member.id,
      role: Role.USER,
    });

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/challenges', challengeRoutes);
    app.use('/api/habits', habitRoutes);
    app.use('/api/admin', adminChallengeRoutes);
    app.use('/api/admin', adminAuditLogRoutes);
    app.use(errorHandler);
  });

  function get(url: string, token?: string) {
    const req = request(app).get(url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  function post(url: string, token?: string) {
    const req = request(app).post(url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  function patch(url: string, token?: string) {
    const req = request(app).patch(url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  function del(url: string, token?: string) {
    const req = request(app).delete(url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  function challengePayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Budget Sprint',
      description: 'Track every expense for the sprint.',
      startDate: isoDay(-2),
      endDate: isoDay(2),
      requirements: [{ name: 'Log expenses daily', frequency: 'DAILY' }],
      ...overrides,
    };
  }

  async function createChallengeViaApi(
    overrides: Record<string, unknown> = {},
    token: string = tokenAdmin
  ): Promise<string> {
    const res = await post('/api/challenges', token).send(
      challengePayload(overrides)
    );
    expect(res.status).toBe(201);
    return res.body.data.challenge.id as string;
  }

  async function seedChallenge(
    overrides: Record<string, unknown> = {}
  ): Promise<string> {
    const created = await testPrisma.challenge.create({
      data: {
        name: 'Seeded challenge',
        description: 'Seeded description',
        category: 'general',
        difficulty: 'MEDIUM',
        points: 0,
        startDate: dayOffset(-1),
        endDate: dayOffset(3),
        ...overrides,
      },
    });
    return created.id;
  }

  async function auditRows(action?: string) {
    return testPrisma.auditLog.findMany({
      where: action ? { action } : {},
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  describe('authorization', () => {
    it('rejects the anonymous admin list with 401', async () => {
      const res = await get('/api/admin/challenges');
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHORIZED');
    });

    it('rejects the anonymous admin detail with 401', async () => {
      const res = await get('/api/admin/challenges/any-id');
      expect(res.status).toBe(401);
    });

    it('rejects a normal USER on the admin list with 403', async () => {
      const res = await get('/api/admin/challenges', tokenUser);
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    });

    it('rejects a normal USER on the admin detail with 403', async () => {
      const id = await createChallengeViaApi();
      const res = await get(`/api/admin/challenges/${id}`, tokenUser);
      expect(res.status).toBe(403);
    });

    it('rejects a USER activation change with 403', async () => {
      const id = await createChallengeViaApi();
      const res = await patch(`/api/challenges/${id}`, tokenUser).send({
        isActive: false,
      });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    });
  });

  describe('spoofing', () => {
    it('ignores a spoofed X-User-Role header for the admin list', async () => {
      const res = await get('/api/admin/challenges', tokenUser).set(
        'X-User-Role',
        'ADMIN'
      );
      expect(res.status).toBe(403);
    });

    it('ignores a spoofed X-User-Role header for mutations', async () => {
      const id = await createChallengeViaApi();
      const res = await patch(`/api/challenges/${id}`, tokenUser)
        .set('X-User-Role', 'ADMIN')
        .send({ isActive: false });
      expect(res.status).toBe(403);
    });

    it('ignores a spoofed X-User-Id header', async () => {
      const res = await get('/api/admin/challenges', tokenUser).set(
        'X-User-Id',
        admin.id
      );
      expect(res.status).toBe(403);
    });

    it('ignores a query role parameter', async () => {
      const res = await get('/api/admin/challenges?role=ADMIN', tokenUser);
      expect(res.status).toBe(403);
    });

    it('ignores a role inside the create body', async () => {
      const res = await post('/api/challenges', tokenUser).send({
        ...challengePayload(),
        role: 'ADMIN',
      });
      expect(res.status).toBe(403);
    });
  });

  describe('admin list', () => {
    it('returns a paginated admin shape with only safe fields', async () => {
      await createChallengeViaApi();
      const res = await get('/api/admin/challenges', tokenAdmin);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(Array.isArray(data.challenges)).toBe(true);
      expect(data.page).toBe(1);
      expect(data.pageSize).toBe(20);
      expect(data.total).toBe(1);
      expect(data.totalPages).toBe(1);

      const row = data.challenges[0];
      expect(Object.keys(row).sort()).toEqual(
        [
          'category',
          'createdAt',
          'description',
          'difficulty',
          'endDate',
          'id',
          'isActive',
          'name',
          'participants',
          'points',
          'requirementCount',
          'startDate',
          'status',
          'type',
          'updatedAt',
        ].sort()
      );
      expect(row.participants).toEqual({ total: 0 });

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('password');
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('refreshToken');
      expect(raw).not.toContain('accessToken');
    });

    it('paginates deterministically with disjoint pages', async () => {
      await testPrisma.challenge.createMany({
        data: Array.from({ length: 25 }, (_, index) => ({
          name: `Bulk challenge ${index}`,
          description: 'bulk',
          category: 'general',
          difficulty: 'MEDIUM' as const,
          points: 0,
          startDate: dayOffset(-index),
          endDate: dayOffset(5),
        })),
      });

      const pageOne = await get(
        '/api/admin/challenges?page=1&pageSize=10',
        tokenAdmin
      );
      expect(pageOne.status).toBe(200);
      expect(pageOne.body.data.total).toBe(25);
      expect(pageOne.body.data.totalPages).toBe(3);
      expect(pageOne.body.data.challenges).toHaveLength(10);

      const pageThree = await get(
        '/api/admin/challenges?page=3&pageSize=10',
        tokenAdmin
      );
      expect(pageThree.body.data.challenges).toHaveLength(5);

      const idsOne = pageOne.body.data.challenges.map(
        (challenge: { id: string }) => challenge.id
      );
      const idsThree = pageThree.body.data.challenges.map(
        (challenge: { id: string }) => challenge.id
      );
      expect(idsOne.some((id: string) => idsThree.includes(id))).toBe(false);

      const starts = pageOne.body.data.challenges.map(
        (challenge: { startDate: string }) => challenge.startDate
      );
      const sorted = [...starts].sort().reverse();
      expect(starts).toEqual(sorted);
    });

    it('rejects pageSize above 50 with 400', async () => {
      const res = await get(
        '/api/admin/challenges?pageSize=51',
        tokenAdmin
      );
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('rejects page below 1 with 400', async () => {
      const res = await get('/api/admin/challenges?page=0', tokenAdmin);
      expect(res.status).toBe(400);
    });

    it('rejects unknown query parameters with 400', async () => {
      const res = await get(
        '/api/admin/challenges?sort=name',
        tokenAdmin
      );
      expect(res.status).toBe(400);
    });

    it('rejects an unknown status or type value with 400', async () => {
      const badStatus = await get(
        '/api/admin/challenges?status=PAUSED',
        tokenAdmin
      );
      expect(badStatus.status).toBe(400);
      const badType = await get(
        '/api/admin/challenges?type=POINTS',
        tokenAdmin
      );
      expect(badType.status).toBe(400);
    });

    it('searches by name, description and category', async () => {
      await seedChallenge({ name: 'Zero Waste Week' });
      await seedChallenge({ name: 'Morning routine', description: 'Zero waste goals' });
      await seedChallenge({ name: 'Running streak', category: 'fitness' });

      const byName = await get(
        '/api/admin/challenges?search=zero%20waste',
        tokenAdmin
      );
      expect(byName.body.data.total).toBe(2);

      const byCategory = await get(
        '/api/admin/challenges?search=FITNESS',
        tokenAdmin
      );
      expect(byCategory.body.data.total).toBe(1);
      expect(byCategory.body.data.challenges[0].name).toBe('Running streak');

      const noMatch = await get(
        '/api/admin/challenges?search=nomatch-anywhere',
        tokenAdmin
      );
      expect(noMatch.status).toBe(200);
      expect(noMatch.body.data.challenges).toEqual([]);
      expect(noMatch.body.data.total).toBe(0);
    });

    it('filters by derived status with matching derived fields', async () => {
      await seedChallenge({
        name: 'Future challenge',
        startDate: dayOffset(4),
        endDate: dayOffset(8),
      });
      await seedChallenge({
        name: 'Live challenge',
        startDate: dayOffset(-1),
        endDate: dayOffset(3),
      });
      await seedChallenge({
        name: 'Past challenge',
        startDate: dayOffset(-10),
        endDate: dayOffset(-5),
      });
      await seedChallenge({
        name: 'Deactivated challenge',
        startDate: dayOffset(-1),
        endDate: dayOffset(3),
        isActive: false,
      });

      const upcoming = await get(
        '/api/admin/challenges?status=UPCOMING',
        tokenAdmin
      );
      expect(upcoming.body.data.challenges).toHaveLength(1);
      expect(upcoming.body.data.challenges[0].name).toBe('Future challenge');
      expect(upcoming.body.data.challenges[0].status).toBe('UPCOMING');

      const active = await get(
        '/api/admin/challenges?status=ACTIVE',
        tokenAdmin
      );
      expect(active.body.data.challenges).toHaveLength(1);
      expect(active.body.data.challenges[0].name).toBe('Live challenge');
      expect(active.body.data.challenges[0].status).toBe('ACTIVE');

      const ended = await get('/api/admin/challenges?status=ENDED', tokenAdmin);
      const endedNames = ended.body.data.challenges.map(
        (challenge: { name: string }) => challenge.name
      );
      expect(endedNames.sort()).toEqual([
        'Deactivated challenge',
        'Past challenge',
      ]);
      for (const challenge of ended.body.data.challenges) {
        expect(challenge.status).toBe('ENDED');
      }
    });

    it('filters by persisted activation independently of derived status', async () => {
      await seedChallenge({
        name: 'Live challenge',
        startDate: dayOffset(-1),
        endDate: dayOffset(3),
      });
      await seedChallenge({
        name: 'Deactivated in window',
        startDate: dayOffset(-1),
        endDate: dayOffset(3),
        isActive: false,
      });

      const active = await get(
        '/api/admin/challenges?active=true',
        tokenAdmin
      );
      expect(active.body.data.challenges.map((c: { name: string }) => c.name)).toEqual([
        'Live challenge',
      ]);

      const inactive = await get(
        '/api/admin/challenges?active=false',
        tokenAdmin
      );
      expect(
        inactive.body.data.challenges.map((c: { name: string }) => c.name)
      ).toEqual(['Deactivated in window']);
    });

    it('filters by startDate range with UTC calendar days', async () => {
      await seedChallenge({ name: 'Old start', startDate: dayOffset(-10), endDate: dayOffset(-8) });
      await seedChallenge({ name: 'In range', startDate: dayOffset(0), endDate: dayOffset(2) });
      await seedChallenge({ name: 'Later start', startDate: dayOffset(10), endDate: dayOffset(12) });

      const inRange = await get(
        `/api/admin/challenges?dateFrom=${isoDay(-1)}&dateTo=${isoDay(1)}`,
        tokenAdmin
      );
      expect(inRange.status).toBe(200);
      expect(inRange.body.data.challenges).toHaveLength(1);
      expect(inRange.body.data.challenges[0].name).toBe('In range');

      const reversed = await get(
        `/api/admin/challenges?dateFrom=${isoDay(1)}&dateTo=${isoDay(-1)}`,
        tokenAdmin
      );
      expect(reversed.status).toBe(400);

      const unbounded = await get(
        '/api/admin/challenges?dateFrom=2015-01-01&dateTo=2035-01-01',
        tokenAdmin
      );
      expect(unbounded.status).toBe(400);

      const malformed = await get(
        '/api/admin/challenges?dateFrom=not-a-date',
        tokenAdmin
      );
      expect(malformed.status).toBe(400);
    });
  });

  describe('admin detail', () => {
    it('returns identity, requirements and participant counts', async () => {
      const id = await createChallengeViaApi();
      const res = await get(`/api/admin/challenges/${id}`, tokenAdmin);

      expect(res.status).toBe(200);
      const challenge = res.body.data.challenge;
      expect(challenge.id).toBe(id);
      expect(challenge.name).toBe('Budget Sprint');
      expect(challenge.type).toBe('HABIT_COMPLETION');
      expect(challenge.requirementCount).toBe(1);
      expect(challenge.requirements).toHaveLength(1);
      expect(challenge.requirements[0]).toMatchObject({
        name: 'Log expenses daily',
        frequency: 'DAILY',
        target: 1,
        mappedParticipants: 0,
      });
      expect(challenge.participants).toEqual({ total: 0, completed: 0 });
      expect(['UPCOMING', 'ACTIVE', 'ENDED']).toContain(challenge.status);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('password');
      expect(raw).not.toContain('passwordHash');
    });

    it('returns 404 CHALLENGE_NOT_FOUND for a missing challenge', async () => {
      const res = await get('/api/admin/challenges/missing-id', tokenAdmin);
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('CHALLENGE_NOT_FOUND');
    });

    it('reports derived participant completion without writing anything', async () => {
      const id = await createChallengeViaApi({
        startDate: isoDay(0),
        endDate: isoDay(5),
      });

      const join = await post(`/api/challenges/${id}/join`, tokenUser);
      expect(join.status).toBe(201);

      const before = await get(`/api/admin/challenges/${id}`, tokenAdmin);
      expect(before.body.data.challenge.participants).toEqual({
        total: 1,
        completed: 0,
      });

      const habitRes = await post('/api/habits', tokenUser).send({
        name: 'Log expenses daily',
        frequency: 'DAILY',
        startDate: isoDay(0),
      });
      expect(habitRes.status).toBe(201);
      const habitId = habitRes.body.data.habit.id;

      const requirementId =
        before.body.data.challenge.requirements[0].id as string;
      const mapped = await post(
        `/api/challenges/${id}/requirements/${requirementId}/habit`,
        tokenUser
      ).send({ habitId });
      expect(mapped.status).toBe(200);

      const completed = await post(`/api/habits/${habitId}/complete`, tokenUser);
      expect(completed.status).toBe(201);

      const after = await get(`/api/admin/challenges/${id}`, tokenAdmin);
      expect(after.body.data.challenge.participants).toEqual({
        total: 1,
        completed: 1,
      });
    });

    it('keeps detail isolated per challenge', async () => {
      const idA = await createChallengeViaApi({ name: 'Challenge A' });
      const idB = await createChallengeViaApi({
        name: 'Challenge B',
        requirements: [{ name: 'Other requirement', frequency: 'WEEKLY' }],
      });

      const detailA = await get(`/api/admin/challenges/${idA}`, tokenAdmin);
      const detailB = await get(`/api/admin/challenges/${idB}`, tokenAdmin);

      expect(detailA.body.data.challenge.name).toBe('Challenge A');
      expect(detailA.body.data.challenge.requirements).toHaveLength(1);
      expect(detailA.body.data.challenge.requirements[0].name).toBe(
        'Log expenses daily'
      );
      expect(detailB.body.data.challenge.name).toBe('Challenge B');
      expect(detailB.body.data.challenge.requirements[0].name).toBe(
        'Other requirement'
      );
    });
  });

  describe('create with audit', () => {
    it('creates a challenge and records an atomic audit event', async () => {
      const res = await post('/api/challenges', tokenAdmin).send(
        challengePayload({ category: 'saving', difficulty: 'HARD', points: 25 })
      );
      expect(res.status).toBe(201);
      const challengeId = res.body.data.challenge.id as string;

      const rows = await auditRows('ADMIN_CHALLENGE_CREATED');
      expect(rows).toHaveLength(1);
      expect(rows[0].actorUserId).toBe(admin.id);
      expect(rows[0].entityType).toBe('Challenge');
      expect(rows[0].entityId).toBe(challengeId);
      expect(rows[0].metadata).toMatchObject({
        name: 'Budget Sprint',
        type: 'HABIT_COMPLETION',
        category: 'saving',
        requirementCount: 1,
        isActive: true,
      });
    });

    it('rejects an inverted date range without writing an audit event', async () => {
      const res = await post('/api/challenges', tokenAdmin).send(
        challengePayload({ startDate: isoDay(3), endDate: isoDay(1) })
      );
      expect(res.status).toBe(400);
      expect(await testPrisma.auditLog.count()).toBe(0);
      expect(await testPrisma.challenge.count()).toBe(0);
    });

    it('rejects empty requirements', async () => {
      const res = await post('/api/challenges', tokenAdmin).send(
        challengePayload({ requirements: [] })
      );
      expect(res.status).toBe(400);
      expect(await testPrisma.auditLog.count()).toBe(0);
    });

    it('enforces the 10-requirement limit', async () => {
      const requirements = Array.from({ length: 11 }, (_, index) => ({
        name: `Requirement ${index}`,
        frequency: 'DAILY',
      }));
      const res = await post('/api/challenges', tokenAdmin).send(
        challengePayload({ requirements })
      );
      expect(res.status).toBe(400);
      expect(await testPrisma.challenge.count()).toBe(0);
    });
  });

  describe('update with audit', () => {
    it('updates a challenge and records changed fields', async () => {
      const id = await createChallengeViaApi();
      const res = await patch(`/api/challenges/${id}`, tokenAdmin).send({
        name: 'Renamed sprint',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.challenge.name).toBe('Renamed sprint');

      const rows = await auditRows('ADMIN_CHALLENGE_UPDATED');
      expect(rows).toHaveLength(1);
      expect(rows[0].actorUserId).toBe(admin.id);
      expect(rows[0].entityId).toBe(id);
      expect(rows[0].entityType).toBe('Challenge');
      expect(rows[0].metadata).toMatchObject({
        name: 'Renamed sprint',
        changedFields: ['name'],
      });
      expect(rows[0].metadata).not.toHaveProperty('previousIsActive');
    });

    it('rejects an empty update body without an audit event', async () => {
      const id = await createChallengeViaApi();
      const before = await testPrisma.auditLog.count();

      const res = await patch(`/api/challenges/${id}`, tokenAdmin).send({});
      expect(res.status).toBe(400);
      expect(await testPrisma.auditLog.count()).toBe(before);
    });

    it('rejects an update that would invert the date range', async () => {
      const id = await createChallengeViaApi();
      const res = await patch(`/api/challenges/${id}`, tokenAdmin).send({
        startDate: isoDay(6),
        endDate: isoDay(1),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('activation with audit', () => {
    it('deactivates, records the transition and derives ENDED', async () => {
      const id = await createChallengeViaApi({
        startDate: isoDay(-1),
        endDate: isoDay(3),
      });

      const res = await patch(`/api/challenges/${id}`, tokenAdmin).send({
        isActive: false,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.challenge.isActive).toBe(false);
      expect(res.body.data.challenge.status).toBe('ENDED');

      const rows = await auditRows('ADMIN_CHALLENGE_UPDATED');
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toMatchObject({
        previousIsActive: true,
        newIsActive: false,
        changedFields: ['isActive'],
      });

      const list = await get('/api/admin/challenges', tokenAdmin);
      expect(list.body.data.challenges[0].status).toBe('ENDED');
      expect(list.body.data.challenges[0].isActive).toBe(false);
    });

    it('keeps a deactivated future challenge derived as UPCOMING', async () => {
      const id = await createChallengeViaApi({
        startDate: isoDay(4),
        endDate: isoDay(6),
      });
      await patch(`/api/challenges/${id}`, tokenAdmin).send({
        isActive: false,
      });

      const detail = await get(`/api/admin/challenges/${id}`, tokenAdmin);
      expect(detail.body.data.challenge.status).toBe('UPCOMING');
      expect(detail.body.data.challenge.isActive).toBe(false);
    });

    it('reactivates and records both transitions separately', async () => {
      const id = await createChallengeViaApi();
      await patch(`/api/challenges/${id}`, tokenAdmin).send({
        isActive: false,
      });
      const reactivated = await patch(`/api/challenges/${id}`, tokenAdmin).send(
        { isActive: true }
      );
      expect(reactivated.status).toBe(200);
      expect(reactivated.body.data.challenge.isActive).toBe(true);

      const rows = await auditRows('ADMIN_CHALLENGE_UPDATED');
      expect(rows).toHaveLength(2);
      expect(rows[0].metadata).toMatchObject({
        previousIsActive: true,
        newIsActive: false,
      });
      expect(rows[1].metadata).toMatchObject({
        previousIsActive: false,
        newIsActive: true,
      });
    });

    it('does not record an activation transition when nothing changes', async () => {
      const id = await createChallengeViaApi();
      const res = await patch(`/api/challenges/${id}`, tokenAdmin).send({
        isActive: true,
      });
      expect(res.status).toBe(200);

      const rows = await auditRows('ADMIN_CHALLENGE_UPDATED');
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).not.toHaveProperty('previousIsActive');
    });
  });

  describe('delete with audit and cascade', () => {
    it('deletes the challenge, cascades children and records the event', async () => {
      const id = await createChallengeViaApi();
      await testPrisma.challengeParticipant.create({
        data: { challengeId: id, userId: member.id },
      });

      const requirement = await testPrisma.challengeHabitRequirement.findFirst({
        where: { challengeId: id },
      });
      expect(requirement).not.toBeNull();

      const res = await del(`/api/challenges/${id}`, tokenAdmin);
      expect(res.status).toBe(200);

      const detail = await get(`/api/admin/challenges/${id}`, tokenAdmin);
      expect(detail.status).toBe(404);

      expect(
        await testPrisma.challengeHabitRequirement.count({
          where: { challengeId: id },
        })
      ).toBe(0);
      expect(
        await testPrisma.challengeParticipant.count({
          where: { challengeId: id },
        })
      ).toBe(0);

      const rows = await auditRows('ADMIN_CHALLENGE_DELETED');
      expect(rows).toHaveLength(1);
      expect(rows[0].actorUserId).toBe(admin.id);
      expect(rows[0].entityId).toBe(id);
      expect(rows[0].metadata).toMatchObject({
        name: 'Budget Sprint',
        type: 'HABIT_COMPLETION',
        participants: 1,
      });
    });

    it('never deletes users financial records when a challenge is deleted', async () => {
      const habitRes = await post('/api/habits', tokenAdmin).send({
        name: 'Daily saving habit',
        frequency: 'DAILY',
        startDate: isoDay(-3),
      });
      expect(habitRes.status).toBe(201);
      const habitId = habitRes.body.data.habit.id as string;
      const completed = await post(`/api/habits/${habitId}/complete`, tokenAdmin);
      expect(completed.status).toBe(201);

      await testPrisma.category.create({
        data: { userId: admin.id, name: 'Salary', type: 'INCOME' },
      });
      const category = await testPrisma.category.findFirstOrThrow({
        where: { userId: admin.id },
      });
      await testPrisma.transaction.create({
        data: {
          userId: admin.id,
          categoryId: category.id,
          type: 'INCOME',
          amount: 9876.54,
          transactionDate: new Date(),
        },
      });

      const id = await createChallengeViaApi();
      const [habitsBefore, completionsBefore, transactionsBefore] =
        await Promise.all([
          testPrisma.financialHabit.count(),
          testPrisma.habitCompletion.count(),
          testPrisma.transaction.count(),
        ]);

      const res = await del(`/api/challenges/${id}`, tokenAdmin);
      expect(res.status).toBe(200);

      const [habitsAfter, completionsAfter, transactionsAfter] =
        await Promise.all([
          testPrisma.financialHabit.count(),
          testPrisma.habitCompletion.count(),
          testPrisma.transaction.count(),
        ]);
      expect(habitsAfter).toBe(habitsBefore);
      expect(completionsAfter).toBe(completionsBefore);
      expect(transactionsAfter).toBe(transactionsBefore);
      expect(await testPrisma.financialHabit.count()).toBe(1);
    });

    it('returns 404 when deleting a missing challenge', async () => {
      const res = await del('/api/challenges/nope', tokenAdmin);
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('CHALLENGE_NOT_FOUND');
    });
  });

  describe('audit safety', () => {
    it('stores no secrets in challenge audit metadata', async () => {
      const id = await createChallengeViaApi();
      await patch(`/api/challenges/${id}`, tokenAdmin).send({
        name: 'Renamed sprint',
        isActive: false,
      });
      await del(`/api/challenges/${id}`, tokenAdmin);

      const rows = await auditRows();
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.action)).toEqual([
        'ADMIN_CHALLENGE_CREATED',
        'ADMIN_CHALLENGE_UPDATED',
        'ADMIN_CHALLENGE_DELETED',
      ]);

      const raw = JSON.stringify(rows);
      expect(raw).not.toContain('password');
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('token');
      expect(raw).not.toContain('refresh');
      expect(raw).not.toContain('secret');
      expect(raw).not.toContain('authorization');
      expect(raw).not.toContain('9876.54');

      for (const row of rows) {
        expect(row.actorUserId).toBe(admin.id);
        expect(row.entityType).toBe('Challenge');
        expect(row.entityId).toBe(id);
      }
    });

    it('exposes challenge events through the Phase 5F-4 audit-log API', async () => {
      const id = await createChallengeViaApi();

      const res = await get(
        `/api/admin/audit-logs?action=ADMIN_CHALLENGE_CREATED&entityId=${id}`,
        tokenAdmin
      );
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
      const entry = res.body.data.auditLogs[0];
      expect(entry.action).toBe('ADMIN_CHALLENGE_CREATED');
      expect(entry.entityType).toBe('Challenge');
      expect(entry.entityId).toBe(id);
      expect(entry.actor?.id).toBe(admin.id);

      const detail = await get(
        `/api/admin/audit-logs?action=ADMIN_CHALLENGE_CREATED`,
        tokenAdmin
      );
      expect(detail.body.data.auditLogs[0].metadata).toMatchObject({
        name: 'Budget Sprint',
        type: 'HABIT_COMPLETION',
      });
    });
  });

  describe('read-only admin operations', () => {
    it('performs no writes on admin list and detail GETs', async () => {
      const id = await createChallengeViaApi();
      await post(`/api/challenges/${id}/join`, tokenUser);

      const auditBefore = await testPrisma.auditLog.count();
      const completionsBefore = await testPrisma.habitCompletion.count();
      const transactionsBefore = await testPrisma.transaction.count();
      const notificationsBefore = await testPrisma.notification.count();

      await get('/api/admin/challenges', tokenAdmin);
      await get(
        '/api/admin/challenges?search=budget&status=ACTIVE&active=true',
        tokenAdmin
      );
      await get(`/api/admin/challenges/${id}`, tokenAdmin);

      expect(await testPrisma.auditLog.count()).toBe(auditBefore);
      expect(await testPrisma.habitCompletion.count()).toBe(
        completionsBefore
      );
      expect(await testPrisma.transaction.count()).toBe(transactionsBefore);
      expect(await testPrisma.notification.count()).toBe(
        notificationsBefore
      );
      expect(
        await testPrisma.challengeParticipant.count({ where: { challengeId: id } })
      ).toBe(1);
    });
  });

  describe('IDOR protection', () => {
    it('blocks a USER from mutating challenges through valid ids', async () => {
      const id = await createChallengeViaApi();

      const createAttempt = await post('/api/challenges', tokenUser).send(
        challengePayload()
      );
      expect(createAttempt.status).toBe(403);

      const updateAttempt = await patch(`/api/challenges/${id}`, tokenUser).send(
        { name: 'Hijacked' }
      );
      expect(updateAttempt.status).toBe(403);

      const deleteAttempt = await del(`/api/challenges/${id}`, tokenUser);
      expect(deleteAttempt.status).toBe(403);

      const surviving = await testPrisma.challenge.findUnique({
        where: { id },
      });
      expect(surviving?.name).toBe('Budget Sprint');
    });

    it('answers admin detail requests only for the requested id', async () => {
      const idA = await createChallengeViaApi({ name: 'Isolated A' });
      const idB = await createChallengeViaApi({ name: 'Isolated B' });

      const forA = await get(`/api/admin/challenges/${idA}`, tokenAdmin);
      const forB = await get(`/api/admin/challenges/${idB}`, tokenAdmin);

      expect(forA.body.data.challenge.id).toBe(idA);
      expect(forB.body.data.challenge.id).toBe(idB);

      const missing = await get(
        '/api/admin/challenges/aaaaaaaaaaaaaaaa',
        tokenAdmin
      );
      expect(missing.status).toBe(404);
    });
  });
});
