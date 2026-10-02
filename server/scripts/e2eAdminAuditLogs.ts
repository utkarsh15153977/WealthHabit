import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { assertSafeE2EDatabaseUrl } from './lib/dbSafety.js';

config();

assertSafeE2EDatabaseUrl(process.env.DATABASE_URL);

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5000/api';
const PASSWORD = 'E2ePassword123!';

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
  const email = `e2e-adminaudit-${label}-${Date.now()}@example.com`;
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

async function main(): Promise<void> {
  console.log(`Admin Audit Logs E2E against ${BASE_URL}\n`);

  const admin = await registerUser('admin');
  const userA = await registerUser('user-a');
  const userB = await registerUser('user-b');
  const createdUserIds: string[] = [admin.id, userA.id, userB.id].filter(
    (id): id is string => typeof id === 'string'
  );
  const prisma = new PrismaClient();

  try {
    console.log('\n1. create controlled ADMIN and seed a financial record');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    const category = await prisma.category.create({
      data: { userId: userA.id, name: 'E2E Audit', type: 'EXPENSE' },
    });
    await prisma.transaction.create({
      data: {
        userId: userA.id,
        categoryId: category.id,
        type: 'EXPENSE',
        amount: 4321.99,
        transactionDate: new Date(),
      },
    });
    console.log('Admin promoted, decoy transaction seeded');

    console.log('\n2. generate audit events through real admin operations');
    const suspend = await call(`/admin/users/${userA.id}/status`, {
      method: 'PATCH',
      token: admin.token,
      body: { status: 'SUSPENDED' },
    });
    check('suspend USER A -> 200 (status event written)', suspend.status === 200, suspend.body);
    const reactivate = await call(`/admin/users/${userA.id}/status`, {
      method: 'PATCH',
      token: admin.token,
      body: { status: 'ACTIVE' },
    });
    check('reactivate USER A -> 200', reactivate.status === 200, reactivate.body);
    const promote = await call(`/admin/users/${userB.id}/role`, {
      method: 'PATCH',
      token: admin.token,
      body: { role: 'ADMIN' },
    });
    check('promote USER B -> 200 (role event written)', promote.status === 200, promote.body);
    const demote = await call(`/admin/users/${userB.id}/role`, {
      method: 'PATCH',
      token: admin.token,
      body: { role: 'USER' },
    });
    check('demote USER B -> 200', demote.status === 200, demote.body);

    const scoped = `actorUserId=${admin.id}`;

    console.log('\n3. anonymous access -> 401');
    check('anonymous list -> 401', (await call('/admin/audit-logs')).status === 401);

    console.log('\n4. normal USER access -> 403');
    const userAccess = await call('/admin/audit-logs', { token: userB.token });
    check('USER list -> 403', userAccess.status === 403);
    const spoofedRole = await fetch(`${BASE_URL}/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${userB.token}`, 'X-User-Role': 'ADMIN' },
    });
    check('USER with X-User-Role: ADMIN -> 403', spoofedRole.status === 403);
    const spoofedId = await fetch(`${BASE_URL}/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${userB.token}`, 'X-User-Id': admin.id },
    });
    check('USER with X-User-Id: admin -> 403', spoofedId.status === 403);
    const spoofedQuery = await fetch(`${BASE_URL}/admin/audit-logs?role=ADMIN`, {
      headers: { Authorization: `Bearer ${userB.token}` },
    });
    check('USER with ?role=ADMIN -> 403', spoofedQuery.status === 403);

    console.log('\n5. ADMIN lists audit logs');
    const list = await call(`/admin/audit-logs?${scoped}`, { token: admin.token });
    check('ADMIN list -> 200', list.status === 200, list.body);
    check('list has auditLogs array', Array.isArray(list.body.data?.auditLogs));
    check('list has pagination meta', typeof list.body.data?.total === 'number');
    check('all 4 events are visible', list.body.data?.total === 4, list.body.data?.total);
    check('list reports page 1', list.body.data?.page === 1);
    const listItem = list.body.data?.auditLogs?.[0] ?? {};
    check(
      'list item exposes only safe fields',
      JSON.stringify(Object.keys(listItem).sort()) ===
        JSON.stringify(
          [
            'action',
            'actor',
            'createdAt',
            'entityId',
            'entityType',
            'id',
            'metadata',
            'target',
          ].sort()
        ),
      Object.keys(listItem)
    );

    console.log('\n6. newest-first ordering');
    const items = list.body.data?.auditLogs ?? [];
    const timestamps = items.map((item: Json) => Date.parse(item.createdAt));
    const nonIncreasing = timestamps.every(
      (value: number, index: number) => index === 0 || value <= timestamps[index - 1]
    );
    check('createdAt is non-increasing (newest first)', nonIncreasing, timestamps);
    check(
      'the most recent event is the USER B demotion',
      items[0]?.action === 'ADMIN_USER_ROLE_CHANGED' &&
        items[0]?.target?.id === userB.id,
      { action: items[0]?.action, target: items[0]?.target }
    );

    console.log('\n7. actor and target information');
    const statusEvents = items.filter(
      (item: Json) =>
        item.action === 'ADMIN_USER_STATUS_CHANGED' && item.target?.id === userA.id
    );
    check('two status events for USER A exist', statusEvents.length === 2);
    const statusEvent = statusEvents[statusEvents.length - 1];
    check('actor is the E2E admin', statusEvent?.actor?.id === admin.id);
    check('actor email is exposed', statusEvent?.actor?.email === admin.email);
    check('target is USER A', statusEvent?.target?.id === userA.id);
    check('target email is exposed', statusEvent?.target?.email === userA.email);
    check('entity type is User', statusEvent?.entityType === 'User');
    check('entity id is the target user id', statusEvent?.entityId === userA.id);
    check(
      'metadata records the suspension transition',
      statusEvent?.metadata?.from === 'ACTIVE' &&
        statusEvent?.metadata?.to === 'SUSPENDED' &&
        statusEvent?.metadata?.targetUserId === userA.id,
      statusEvent?.metadata
    );
    check(
      'metadata revokedSessions is a number',
      typeof statusEvent?.metadata?.revokedSessions === 'number'
    );

    const roleEvents = items.filter(
      (item: Json) =>
        item.action === 'ADMIN_USER_ROLE_CHANGED' && item.target?.id === userB.id
    );
    check('two role events for USER B exist', roleEvents.length === 2);
    const promoteEvent = roleEvents[roleEvents.length - 1];
    check(
      'role event metadata records the promotion USER -> ADMIN',
      promoteEvent?.metadata?.from === 'USER' &&
        promoteEvent?.metadata?.to === 'ADMIN',
      promoteEvent?.metadata
    );

    console.log('\n8. action filter');
    const statusOnly = await call(
      `/admin/audit-logs?${scoped}&action=ADMIN_USER_STATUS_CHANGED`,
      { token: admin.token }
    );
    check('action filter -> 200', statusOnly.status === 200);
    check('action filter returns exactly 2 events', statusOnly.body.data?.total === 2);
    check(
      'action filter returns only status events',
      (statusOnly.body.data?.auditLogs ?? []).every(
        (item: Json) => item.action === 'ADMIN_USER_STATUS_CHANGED'
      )
    );
    const badAction = await call(`/admin/audit-logs?action=NOT_A_REAL_ACTION`, {
      token: admin.token,
    });
    check('invalid action -> 400', badAction.status === 400);

    console.log('\n9. actor and target filters');
    const byActor = await call(`/admin/audit-logs?actorUserId=${admin.id}`, {
      token: admin.token,
    });
    check('actor filter returns all 4 events', byActor.body.data?.total === 4);
    const byTarget = await call(
      `/admin/audit-logs?${scoped}&entityId=${userB.id}`,
      { token: admin.token }
    );
    check('target filter returns 2 events', byTarget.body.data?.total === 2);
    check(
      'target filter returns only USER B events',
      (byTarget.body.data?.auditLogs ?? []).every(
        (item: Json) => item.entityId === userB.id
      )
    );
    const badActor = await call('/admin/audit-logs?actorUserId=notanid', {
      token: admin.token,
    });
    check('malformed actor id -> 400', badActor.status === 400);

    console.log('\n10. date filters');
    const today = await call(
      `/admin/audit-logs?${scoped}&dateFrom=${isoDayOffset(0)}`,
      { token: admin.token }
    );
    check('dateFrom=today -> 200', today.status === 200);
    check('dateFrom=today includes today\'s events', today.body.data?.total === 4);
    const future = await call(
      `/admin/audit-logs?${scoped}&dateFrom=${isoDayOffset(1)}`,
      { token: admin.token }
    );
    check('dateFrom=tomorrow -> 200 with no events', future.body.data?.total === 0);
    const reversed = await call(
      `/admin/audit-logs?dateFrom=${isoDayOffset(2)}&dateTo=${isoDayOffset(1)}`,
      { token: admin.token }
    );
    check('reversed date range -> 400', reversed.status === 400);
    const badDate = await call('/admin/audit-logs?dateFrom=not-a-date', {
      token: admin.token,
    });
    check('malformed dateFrom -> 400', badDate.status === 400);
    const unbounded = await call(
      '/admin/audit-logs?dateFrom=2000-01-01&dateTo=2026-01-01',
      { token: admin.token }
    );
    check('unbounded date range -> 400', unbounded.status === 400);

    console.log('\n11. search');
    const byEmail = await call(
      `/admin/audit-logs?${scoped}&search=${encodeURIComponent(admin.email)}`,
      { token: admin.token }
    );
    check('search by actor email finds all 4 events', byEmail.body.data?.total === 4);
    const byTargetEmail = await call(
      `/admin/audit-logs?${scoped}&search=${encodeURIComponent(userB.email)}`,
      { token: admin.token }
    );
    check('search by target email finds 2 events', byTargetEmail.body.data?.total === 2);
    const noMatch = await call('/admin/audit-logs?search=zzz-no-such-thing', {
      token: admin.token,
    });
    check('search with no match -> empty page', noMatch.body.data?.total === 0);
    check(
      'search with no match returns no rows',
      Array.isArray(noMatch.body.data?.auditLogs) &&
        noMatch.body.data.auditLogs.length === 0
    );

    console.log('\n12. pagination');
    const pageOne = await call(`/admin/audit-logs?${scoped}&pageSize=2&page=1`, {
      token: admin.token,
    });
    check('page 1 returns 2 events', pageOne.body.data?.auditLogs?.length === 2);
    check('page 1 reports total 4', pageOne.body.data?.total === 4);
    check('page 1 reports 2 total pages', pageOne.body.data?.totalPages === 2);
    const pageTwo = await call(`/admin/audit-logs?${scoped}&pageSize=2&page=2`, {
      token: admin.token,
    });
    check('page 2 returns 2 events', pageTwo.body.data?.auditLogs?.length === 2);
    const pageOneIds = (pageOne.body.data?.auditLogs ?? []).map((item: Json) => item.id);
    const pageTwoIds = (pageTwo.body.data?.auditLogs ?? []).map((item: Json) => item.id);
    check(
      'pages are disjoint',
      pageOneIds.every((id: string) => !pageTwoIds.includes(id)),
      { pageOneIds, pageTwoIds }
    );
    const bigPage = await call(`/admin/audit-logs?pageSize=51`, { token: admin.token });
    check('pageSize > 50 -> 400', bigPage.status === 400);
    const badPage = await call(`/admin/audit-logs?page=0`, { token: admin.token });
    check('page < 1 -> 400', badPage.status === 400);
    const badQuery = await call(`/admin/audit-logs?foo=bar`, { token: admin.token });
    check('unknown query parameter -> 400', badQuery.status === 400);

    console.log('\n13. sensitive data is never exposed');
    const rawResponses =
      JSON.stringify(list.body) +
      JSON.stringify(statusOnly.body) +
      JSON.stringify(byTarget.body) +
      JSON.stringify(pageOne.body);
    check('no passwordHash in responses', !rawResponses.includes('passwordHash'));
    check(
      'no refreshTokenHash in responses',
      !rawResponses.includes('refreshTokenHash')
    );
    check(
      'no previousRefreshTokenHash in responses',
      !rawResponses.includes('previousRefreshTokenHash')
    );
    check('no accessToken in responses', !rawResponses.includes('accessToken'));
    check('no password field in responses', !rawResponses.includes('"password"'));
    check('the password value never appears', !rawResponses.includes(PASSWORD));
    check('the access token never appears', !rawResponses.includes(admin.token));
    check(
      'no refresh cookie name in responses',
      !rawResponses.includes('wh_refresh_token')
    );
    check('no seeded financial amount', !rawResponses.includes('4321.99'));
    check('no amount key in responses', !rawResponses.includes('"amount"'));

    console.log('\n14. audit logs are immutable through the API');
    const before = await prisma.auditLog.count({ where: { actorUserId: admin.id } });
    const firstId = items[0]?.id;
    const delBare = await fetch(`${BASE_URL}/admin/audit-logs`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    check('DELETE /audit-logs -> 404', delBare.status === 404);
    const delById = await fetch(`${BASE_URL}/admin/audit-logs/${firstId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    check('DELETE /audit-logs/:id -> 404', delById.status === 404);
    const patchById = await fetch(`${BASE_URL}/admin/audit-logs/${firstId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${admin.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'TAMPERED' }),
    });
    check('PATCH /audit-logs/:id -> 404', patchById.status === 404);
    const putById = await fetch(`${BASE_URL}/admin/audit-logs/${firstId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${admin.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'TAMPERED' }),
    });
    check('PUT /audit-logs/:id -> 404', putById.status === 404);
    const postRes = await fetch(`${BASE_URL}/admin/audit-logs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${admin.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'FORGED', entityType: 'User' }),
    });
    check('POST /audit-logs -> 404', postRes.status === 404);
    const after = await prisma.auditLog.count({ where: { actorUserId: admin.id } });
    check('audit row count is unchanged', before === after, { before, after });
    const tampered = await prisma.auditLog.findUnique({ where: { id: firstId } });
    check('the original action was never modified', tampered?.action !== 'TAMPERED');
  } finally {
    try {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: createdUserIds } },
            { entityId: { in: createdUserIds } },
          ],
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      console.log('\n15. cleanup: removed throwaway users and audit entries');
    } finally {
      await prisma.$disconnect();
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
    console.log('E2E admin audit logs: PASS');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\nE2E admin audit logs: ERROR\n${String(error)}`);
    process.exit(1);
  });
