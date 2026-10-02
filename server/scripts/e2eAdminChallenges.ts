import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { assertSafeE2EDatabaseUrl } from './lib/dbSafety.js';

config();

assertSafeE2EDatabaseUrl(process.env.DATABASE_URL);

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5000/api';
const PASSWORD = 'E2ePassword123!';
const NAME_PREFIX = 'E2E AdminCh';

type Json = Record<string, any>;

interface CallResult {
  status: number;
  body: Json;
  setCookie?: string;
}

interface E2eUser {
  token: string;
  id: string;
  email: string;
  cookie: string | undefined;
}

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.error(
      `  FAIL ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`
    );
  }
}

async function call(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    cookie?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<CallResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.cookie ? { Cookie: options.cookie } : {}),
    ...(options.headers ?? {}),
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const setCookie = response.headers.get('set-cookie') ?? undefined;
  const text = await response.text();
  let body: Json = {};
  if (text) {
    try {
      body = JSON.parse(text) as Json;
    } catch {
      body = { raw: text };
    }
  }

  return { status: response.status, body, setCookie };
}

async function registerUser(label: string): Promise<E2eUser> {
  const email = `e2e-adminchallenges-${label}-${Date.now()}@example.com`;
  const result = await call('/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, firstName: 'E2E', lastName: label },
  });
  if (result.status !== 201 && result.status !== 200) {
    throw new Error(
      `register failed for ${label}: ${result.status} ${JSON.stringify(result.body)}`
    );
  }
  const token = result.body.data?.accessToken ?? result.body.accessToken;
  const id = result.body.data?.user?.id ?? result.body.user?.id;
  const userEmail = result.body.data?.user?.email ?? result.body.user?.email ?? email;
  if (!token) {
    throw new Error(`no access token for ${label}: ${JSON.stringify(result.body)}`);
  }
  const cookie = result.setCookie ? result.setCookie.split(';')[0] : undefined;
  return { token, id, email: userEmail, cookie };
}

function isoDayOffset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

const CHALLENGE_AUDIT_ACTIONS = [
  'ADMIN_CHALLENGE_CREATED',
  'ADMIN_CHALLENGE_UPDATED',
  'ADMIN_CHALLENGE_DELETED',
];

async function main(): Promise<void> {
  console.log(`Admin Challenges E2E against ${BASE_URL}\n`);

  const stamp = Date.now();
  const searchTokenA = `${NAME_PREFIX} Alpha ${stamp}`;
  const searchTokenB = `${NAME_PREFIX} Beta ${stamp}`;
  const startA = isoDayOffset(-1);
  const endA = isoDayOffset(2);
  const startB = isoDayOffset(0);
  const endB = isoDayOffset(1);
  const today = isoDayOffset(0);

  const admin = await registerUser('admin');
  const member = await registerUser('member');
  const createdUserIds: string[] = [admin.id, member.id].filter(
    (id): id is string => typeof id === 'string'
  );
  const db = new PrismaClient();

  // Defensive pre-clean so leftovers from a previous crashed run can never
  // leak into this run's assertions or into the global audit-log total
  // asserted by e2e:admin-audit-logs.
  await db.auditLog.deleteMany({
    where: { action: { in: CHALLENGE_AUDIT_ACTIONS } },
  });
  await db.challenge.deleteMany({
    where: { name: { startsWith: NAME_PREFIX } },
  });

  let challengeAId = '';
  let challengeBId = '';
  let requirementAId = '';
  let requirementBId = '';
  let habitId = '';

  try {
    console.log('\n1. create controlled ADMIN');
    await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    console.log('Admin promoted');

    console.log('\n2. ADMIN creates two challenges');
    const createA = await call('/challenges', {
      method: 'POST',
      token: admin.token,
      body: {
        name: searchTokenA,
        description: 'Track daily spending for the E2E run.',
        category: 'E2E-Category',
        difficulty: 'MEDIUM',
        points: 100,
        startDate: startA,
        endDate: endA,
        requirements: [
          {
            name: 'Log spending daily',
            description: 'One entry per day.',
            frequency: 'DAILY',
            target: 1,
            unit: 'times',
          },
        ],
      },
    });
    check('create challenge A -> 201', createA.status === 201, createA.body);
    challengeAId = createA.body.data?.challenge?.id ?? '';
    requirementAId =
      createA.body.data?.challenge?.requirements?.[0]?.id ?? '';
    check('challenge A has an id', typeof challengeAId === 'string' && challengeAId.length > 0);
    check('challenge A exposes its requirement', requirementAId.length > 0);
    check(
      'challenge A echoes the payload',
      createA.body.data?.challenge?.name === searchTokenA &&
        createA.body.data?.challenge?.points === 100 &&
        createA.body.data?.challenge?.isActive === true,
      createA.body.data?.challenge
    );

    const createB = await call('/challenges', {
      method: 'POST',
      token: admin.token,
      body: {
        name: searchTokenB,
        difficulty: 'EASY',
        points: 10,
        startDate: startB,
        endDate: endB,
        requirements: [
          { name: 'Check in once', frequency: 'DAILY', target: 1, unit: 'times' },
        ],
      },
    });
    check('create challenge B -> 201', createB.status === 201, createB.body);
    challengeBId = createB.body.data?.challenge?.id ?? '';
    requirementBId =
      createB.body.data?.challenge?.requirements?.[0]?.id ?? '';
    check('challenge B has an id', challengeBId.length > 0);

    console.log('\n3. anonymous access -> 401');
    check('anonymous admin list -> 401', (await call('/admin/challenges')).status === 401);
    check(
      'anonymous admin detail -> 401',
      (await call(`/admin/challenges/${challengeAId}`)).status === 401
    );

    console.log('\n4. normal USER access -> 403');
    const memberList = await call('/admin/challenges', { token: member.token });
    check('USER admin list -> 403', memberList.status === 403, memberList.body);
    const memberDetail = await call(`/admin/challenges/${challengeAId}`, {
      token: member.token,
    });
    check('USER admin detail -> 403', memberDetail.status === 403);
    const memberCreate = await call('/challenges', {
      method: 'POST',
      token: member.token,
      body: {
        name: 'USER should not create',
        startDate: startA,
        endDate: endA,
        requirements: [{ name: 'x', frequency: 'DAILY', target: 1 }],
      },
    });
    check('USER create challenge -> 403', memberCreate.status === 403);
    const memberPatch = await call(`/challenges/${challengeAId}`, {
      method: 'PATCH',
      token: member.token,
      body: { points: 1 },
    });
    check('USER update challenge -> 403', memberPatch.status === 403);
    const memberDelete = await call(`/challenges/${challengeAId}`, {
      method: 'DELETE',
      token: member.token,
    });
    check('USER delete challenge -> 403', memberDelete.status === 403);
    const spoofedRole = await fetch(`${BASE_URL}/admin/challenges`, {
      headers: { Authorization: `Bearer ${member.token}`, 'X-User-Role': 'ADMIN' },
    });
    check('USER with X-User-Role: ADMIN -> 403', spoofedRole.status === 403);
    const spoofedId = await fetch(`${BASE_URL}/admin/challenges`, {
      headers: { Authorization: `Bearer ${member.token}`, 'X-User-Id': admin.id },
    });
    check('USER with X-User-Id: admin -> 403', spoofedId.status === 403);

    console.log('\n5. existing create validation stays strict');
    const emptyRequirements = await call('/challenges', {
      method: 'POST',
      token: admin.token,
      body: {
        name: 'No requirements',
        startDate: startA,
        endDate: endA,
        requirements: [],
      },
    });
    check('create with zero requirements -> 400', emptyRequirements.status === 400);
    const invertedDates = await call('/challenges', {
      method: 'POST',
      token: admin.token,
      body: {
        name: 'Inverted dates',
        startDate: endA,
        endDate: startA,
        requirements: [{ name: 'x', frequency: 'DAILY', target: 1 }],
      },
    });
    check('create with end before start -> 400', invertedDates.status === 400);

    console.log('\n6. ADMIN lists challenges');
    const list = await call('/admin/challenges?pageSize=50', { token: admin.token });
    check('ADMIN list -> 200', list.status === 200, list.body);
    check('list has challenges array', Array.isArray(list.body.data?.challenges));
    check('list has pagination meta', typeof list.body.data?.total === 'number');
    check('list reports page 1', list.body.data?.page === 1);
    const listItem = (list.body.data?.challenges ?? []).find(
      (item: Json) => item.id === challengeAId
    );
    check('challenge A appears in the list', Boolean(listItem), listItem);
    check(
      'list item exposes only safe fields',
      JSON.stringify(Object.keys(listItem ?? {}).sort()) ===
        JSON.stringify(
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
        ),
      Object.keys(listItem ?? {})
    );
    check(
      'list item reports derived ACTIVE status',
      listItem?.status === 'ACTIVE',
      listItem?.status
    );
    check(
      'list item reports participants total 0',
      listItem?.participants?.total === 0,
      listItem?.participants
    );

    console.log('\n7. search is scoped and case-insensitive');
    const bySearch = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}`,
      { token: admin.token }
    );
    check('search by exact name -> 200', bySearch.status === 200);
    check(
      'search returns only challenge A',
      bySearch.body.data?.total === 1 &&
        bySearch.body.data?.challenges?.every((item: Json) => item.id === challengeAId),
      bySearch.body.data?.total
    );
    const bySearchUpper = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA.toUpperCase())}`,
      { token: admin.token }
    );
    check('search is case-insensitive', bySearchUpper.body.data?.total === 1);
    const noMatch = await call('/admin/challenges?search=zzz-no-such-thing', {
      token: admin.token,
    });
    check('search with no match -> empty page', noMatch.body.data?.total === 0);

    console.log('\n8. strict query validation');
    const unknownParam = await call('/admin/challenges?foo=bar', {
      token: admin.token,
    });
    check('unknown query parameter -> 400', unknownParam.status === 400);
    const badPage = await call('/admin/challenges?page=0', { token: admin.token });
    check('page < 1 -> 400', badPage.status === 400);
    const bigPage = await call('/admin/challenges?pageSize=51', { token: admin.token });
    check('pageSize > 50 -> 400', bigPage.status === 400);
    const badStatus = await call('/admin/challenges?status=BOGUS', {
      token: admin.token,
    });
    check('invalid status -> 400', badStatus.status === 400);
    const badType = await call('/admin/challenges?type=NOT_A_TYPE', {
      token: admin.token,
    });
    check('invalid type -> 400', badType.status === 400);
    const badActive = await call('/admin/challenges?active=yes', {
      token: admin.token,
    });
    check('invalid active value -> 400', badActive.status === 400);

    console.log('\n9. date range validation');
    const badDate = await call('/admin/challenges?dateFrom=not-a-date', {
      token: admin.token,
    });
    check('malformed dateFrom -> 400', badDate.status === 400);
    const reversed = await call(
      `/admin/challenges?dateFrom=${isoDayOffset(2)}&dateTo=${isoDayOffset(1)}`,
      { token: admin.token }
    );
    check('reversed date range -> 400', reversed.status === 400);
    const unbounded = await call(
      '/admin/challenges?dateFrom=2000-01-01&dateTo=2026-01-01',
      { token: admin.token }
    );
    check('unbounded date range -> 400', unbounded.status === 400);

    console.log('\n10. type, status, activation and startDate filters');
    const byType = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}&type=HABIT_COMPLETION`,
      { token: admin.token }
    );
    check('type filter finds challenge A', byType.body.data?.total === 1);
    const byStatus = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}&status=ACTIVE`,
      { token: admin.token }
    );
    check('status=ACTIVE finds challenge A', byStatus.body.data?.total === 1);
    const byUpcoming = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}&status=UPCOMING`,
      { token: admin.token }
    );
    check('status=UPCOMING excludes challenge A', byUpcoming.body.data?.total === 0);
    const activeTrue = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}&active=true`,
      { token: admin.token }
    );
    check('active=true finds challenge A', activeTrue.body.data?.total === 1);
    const dateToday = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}&dateFrom=${today}&dateTo=${today}`,
      { token: admin.token }
    );
    check('dateFrom=dateTo=today excludes A (starts yesterday)',
      dateToday.body.data?.total === 0, dateToday.body.data?.total);
    const dateWindow = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}&dateFrom=${isoDayOffset(-2)}&dateTo=${isoDayOffset(-1)}`,
      { token: admin.token }
    );
    check('date window covering A\'s startDate includes A',
      dateWindow.body.data?.total === 1, dateWindow.body.data?.total);

    console.log('\n11. ADMIN reads challenge detail');
    const detail = await call(`/admin/challenges/${challengeAId}`, {
      token: admin.token,
    });
    check('ADMIN detail -> 200', detail.status === 200, detail.body);
    const detailChallenge = detail.body.data?.challenge ?? {};
    check('detail exposes the challenge', detailChallenge.id === challengeAId);
    check(
      'detail lists the requirement with mappedParticipants 0',
      detailChallenge.requirements?.length === 1 &&
        detailChallenge.requirements[0]?.name === 'Log spending daily' &&
        detailChallenge.requirements[0]?.mappedParticipants === 0,
      detailChallenge.requirements
    );
    check(
      'detail reports participants {total: 0, completed: 0}',
      detailChallenge.participants?.total === 0 &&
        detailChallenge.participants?.completed === 0,
      detailChallenge.participants
    );
    const missing = await call('/admin/challenges/cm00000000000000000000000', {
      token: admin.token,
    });
    check('detail for a missing id -> 404', missing.status === 404, missing.body);

    console.log('\n12. member joins, maps a habit and completes it');
    const join = await call(`/challenges/${challengeAId}/join`, {
      method: 'POST',
      token: member.token,
    });
    check('member joins challenge A -> 201', join.status === 201, join.body);
    const habit = await call('/habits', {
      method: 'POST',
      token: member.token,
      body: {
        name: 'E2E spending log habit',
        frequency: 'DAILY',
        target: 1,
        unit: 'times',
        startDate: today,
      },
    });
    check('member creates a DAILY habit -> 201', habit.status === 201, habit.body);
    habitId = habit.body.data?.habit?.id ?? '';
    check('habit has an id', habitId.length > 0);
    const map = await call(
      `/challenges/${challengeAId}/requirements/${requirementAId}/habit`,
      { method: 'POST', token: member.token, body: { habitId } }
    );
    check('member maps the habit to the requirement -> 201',
      map.status === 201 || map.status === 200, map.body);
    const complete = await call(`/habits/${habitId}/complete`, {
      method: 'POST',
      token: member.token,
    });
    check('member completes the habit today -> 201',
      complete.status === 201, complete.body);

    const detailAfter = await call(`/admin/challenges/${challengeAId}`, {
      token: admin.token,
    });
    const afterChallenge = detailAfter.body.data?.challenge ?? {};
    check(
      'detail now reports participants {total: 1, completed: 1}',
      afterChallenge.participants?.total === 1 &&
        afterChallenge.participants?.completed === 1,
      afterChallenge.participants
    );
    check(
      'requirement now reports mappedParticipants 1',
      afterChallenge.requirements?.[0]?.mappedParticipants === 1,
      afterChallenge.requirements
    );

    console.log('\n13. deactivation round-trip keeps status and activation filters consistent');
    const deactivate = await call(`/challenges/${challengeAId}`, {
      method: 'PATCH',
      token: admin.token,
      body: { name: `${searchTokenA} renamed`, isActive: false },
    });
    check('rename + deactivate -> 200', deactivate.status === 200, deactivate.body);
    check(
      'update response reflects the new values',
      deactivate.body.data?.challenge?.name === `${searchTokenA} renamed` &&
        deactivate.body.data?.challenge?.isActive === false,
      deactivate.body.data?.challenge
    );
    const statusEnded = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}&status=ENDED`,
      { token: admin.token }
    );
    check('deactivated A derives status ENDED',
      statusEnded.body.data?.total === 1 &&
        statusEnded.body.data?.challenges?.[0]?.status === 'ENDED',
      statusEnded.body.data?.challenges?.[0]?.status);
    const activeFalse = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}&active=false`,
      { token: admin.token }
    );
    check('active=false finds deactivated A', activeFalse.body.data?.total === 1);
    const activeTrueWhileOff = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}&active=true`,
      { token: admin.token }
    );
    check('active=true excludes deactivated A', activeTrueWhileOff.body.data?.total === 0);

    const reactivate = await call(`/challenges/${challengeAId}`, {
      method: 'PATCH',
      token: admin.token,
      body: { isActive: true },
    });
    check('reactivate -> 200', reactivate.status === 200, reactivate.body);
    const activeAgain = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}&active=true`,
      { token: admin.token }
    );
    check('active=true finds A again', activeAgain.body.data?.total === 1);
    const statusActiveAgain = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenA)}&status=ACTIVE`,
      { token: admin.token }
    );
    check('status=ACTIVE finds A again', statusActiveAgain.body.data?.total === 1);

    console.log('\n14. requirements are immutable after creation');
    const patchRequirements = await call(`/challenges/${challengeAId}`, {
      method: 'PATCH',
      token: admin.token,
      body: { requirements: [] },
    });
    check('PATCH with a requirements field -> 400', patchRequirements.status === 400,
      patchRequirements.body);

    console.log('\n15. challenge audit events are retrievable');
    const createdEvents = await call(
      `/admin/audit-logs?actorUserId=${admin.id}&action=ADMIN_CHALLENGE_CREATED`,
      { token: admin.token }
    );
    check('created audit query -> 200', createdEvents.status === 200);
    check('exactly 2 created events', createdEvents.body.data?.total === 2,
      createdEvents.body.data?.total);
    const createdA = (createdEvents.body.data?.auditLogs ?? []).find(
      (item: Json) => item.entityId === challengeAId
    );
    check('created event targets challenge A', Boolean(createdA));
    check(
      'created event metadata describes A',
      createdA?.entityType === 'Challenge' &&
        createdA?.metadata?.name === searchTokenA &&
        createdA?.metadata?.type === 'HABIT_COMPLETION' &&
        createdA?.metadata?.requirementCount === 1 &&
        createdA?.metadata?.startDate === startA &&
        createdA?.metadata?.endDate === endA &&
        createdA?.actor?.id === admin.id,
      createdA?.metadata
    );
    const updatedEvents = await call(
      `/admin/audit-logs?actorUserId=${admin.id}&action=ADMIN_CHALLENGE_UPDATED`,
      { token: admin.token }
    );
    check('exactly 2 updated events', updatedEvents.body.data?.total === 2,
      updatedEvents.body.data?.total);
    const updates = updatedEvents.body.data?.auditLogs ?? [];
    const activationUpdate = updates.find(
      (item: Json) => item.metadata?.newIsActive === false
    );
    check(
      'deactivation update records the activation transition',
      Boolean(activationUpdate) &&
        activationUpdate?.metadata?.previousIsActive === true &&
        activationUpdate?.metadata?.newIsActive === false,
      activationUpdate?.metadata
    );
    check(
      'update metadata lists changed fields including name',
      Boolean(activationUpdate) &&
        Array.isArray(activationUpdate?.metadata?.changedFields) &&
        activationUpdate?.metadata?.changedFields.includes('name') &&
        activationUpdate?.metadata?.changedFields.includes('isActive'),
      activationUpdate?.metadata?.changedFields
    );
    const reactivationUpdate = updates.find(
      (item: Json) => item.metadata?.newIsActive === true
    );
    check(
      'reactivation update records previousIsActive false',
      Boolean(reactivationUpdate) &&
        reactivationUpdate?.metadata?.previousIsActive === false,
      reactivationUpdate?.metadata
    );

    console.log('\n16. ADMIN deletes challenge B without touching financial habits');
    const joinB = await call(`/challenges/${challengeBId}/join`, {
      method: 'POST',
      token: member.token,
    });
    check('member joins challenge B -> 201', joinB.status === 201, joinB.body);
    const mapB = await call(
      `/challenges/${challengeBId}/requirements/${requirementBId}/habit`,
      { method: 'POST', token: member.token, body: { habitId } }
    );
    check('member maps the same habit to B -> 201/200',
      mapB.status === 201 || mapB.status === 200, mapB.body);
    const deleteB = await call(`/challenges/${challengeBId}`, {
      method: 'DELETE',
      token: admin.token,
    });
    check('delete challenge B -> 200', deleteB.status === 200, deleteB.body);
    const deletedAudit = await call(
      `/admin/audit-logs?actorUserId=${admin.id}&action=ADMIN_CHALLENGE_DELETED`,
      { token: admin.token }
    );
    check('exactly 1 deleted event', deletedAudit.body.data?.total === 1,
      deletedAudit.body.data?.total);
    const deletedEvent = deletedAudit.body.data?.auditLogs?.[0] ?? {};
    check(
      'deleted event metadata describes B and its participant',
      deletedEvent.entityId === challengeBId &&
        deletedEvent.metadata?.name === searchTokenB &&
        deletedEvent.metadata?.participants === 1,
      deletedEvent.metadata
    );
    const searchB = await call(
      `/admin/challenges?search=${encodeURIComponent(searchTokenB)}`,
      { token: admin.token }
    );
    check('deleted B no longer appears in the list', searchB.body.data?.total === 0);
    const detailB = await call(`/admin/challenges/${challengeBId}`, {
      token: admin.token,
    });
    check('deleted B detail -> 404', detailB.status === 404);
    const habitStill = await call(`/habits/${habitId}`, { token: member.token });
    check('financial habit survives the challenge delete',
      habitStill.status === 200, habitStill.body);
    const progress = await call(`/habits/${habitId}/progress`, {
      token: member.token,
    });
    check('habit progress is intact', progress.status === 200, progress.body);

    console.log('\n17. sensitive data is never exposed');
    const rawResponses =
      JSON.stringify(list.body) +
      JSON.stringify(detail.body) +
      JSON.stringify(detailAfter.body) +
      JSON.stringify(createdEvents.body) +
      JSON.stringify(deletedAudit.body);
    check('no passwordHash in responses', !rawResponses.includes('passwordHash'));
    check(
      'no refreshTokenHash in responses',
      !rawResponses.includes('refreshTokenHash')
    );
    check('no accessToken in responses', !rawResponses.includes('accessToken'));
    check('the password value never appears', !rawResponses.includes(PASSWORD));
    check('the access token never appears', !rawResponses.includes(admin.token));
  } finally {
    try {
      await db.challenge.deleteMany({
        where: { id: { in: [challengeAId, challengeBId].filter(Boolean) } },
      });
      await db.challenge.deleteMany({
        where: { name: { startsWith: NAME_PREFIX } },
      });
      await db.auditLog.deleteMany({
        where: {
          OR: [
            { action: { in: CHALLENGE_AUDIT_ACTIONS } },
            { actorUserId: { in: createdUserIds } },
            { entityId: { in: [challengeAId, challengeBId].filter(Boolean) } },
          ],
        },
      });
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      console.log('\n18. cleanup: removed throwaway challenges, users and audit entries');
    } finally {
      await db.$disconnect();
    }
  }
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
      console.error(`Failures:\n - ${failures.join('\n - ')}`);
      process.exit(1);
    }
    console.log('E2E admin challenges: PASS');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\nE2E admin challenges: ERROR\n${String(error)}`);
    process.exit(1);
  });
