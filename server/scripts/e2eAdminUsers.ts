import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { assertSafeE2EDatabaseUrl } from './lib/dbSafety.js';

config();

assertSafeE2EDatabaseUrl(process.env.DATABASE_URL);

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5000/api';
const PASSWORD = 'E2ePassword123!';
const COOKIE_NAME = process.env.COOKIE_NAME || 'wh_refresh_token';

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
  const email = `e2e-adminusers-${label}-${Date.now()}@example.com`;
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

async function main(): Promise<void> {
  console.log(`Admin Users E2E against ${BASE_URL}\n`);

  const admin = await registerUser('admin');
  const userA = await registerUser('user-a');
  const userB = await registerUser('user-b');
  const createdUserIds: string[] = [admin.id, userA.id, userB.id].filter(
    (id): id is string => typeof id === 'string'
  );
  const prisma = new PrismaClient();

  try {
    console.log('\n1. create controlled ADMIN');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    console.log('Admin user promoted');

    console.log('\n2-3. USER A and USER B already registered');
    check('user A registered', Boolean(userA.id));
    check('user B registered', Boolean(userB.id));

    console.log('\nseed financial records for user A');
    const category = await prisma.category.create({
      data: { userId: userA.id, name: 'E2E Admin Users', type: 'EXPENSE' },
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
    await prisma.transaction.create({
      data: {
        userId: userA.id,
        categoryId: category.id,
        type: 'EXPENSE',
        amount: 8765.43,
        transactionDate: new Date(),
      },
    });
    await prisma.savingsGoal.create({
      data: {
        userId: userA.id,
        name: 'E2E Goal',
        targetAmount: 9999.99,
        targetDate: new Date('2027-06-01'),
        category: 'general',
      },
    });
    await prisma.asset.create({
      data: { userId: userA.id, name: 'E2E Asset', type: 'CASH', currentValue: 5555.55 },
    });
    await prisma.liability.create({
      data: {
        userId: userA.id,
        name: 'E2E Liability',
        type: 'CREDIT_CARD',
        outstandingAmount: 1111.11,
      },
    });
    await prisma.financialHabit.create({
      data: {
        userId: userA.id,
        name: 'E2E Habit',
        frequency: 'DAILY',
        startDate: new Date(),
      },
    });

    const recordsBefore = {
      transactions: await prisma.transaction.count({ where: { userId: userA.id } }),
      goals: await prisma.savingsGoal.count({ where: { userId: userA.id } }),
      assets: await prisma.asset.count({ where: { userId: userA.id } }),
      liabilities: await prisma.liability.count({ where: { userId: userA.id } }),
      habits: await prisma.financialHabit.count({ where: { userId: userA.id } }),
    };

    console.log('\n4. anonymous access -> 401');
    check('anonymous list -> 401', (await call('/admin/users')).status === 401);
    check(
      'anonymous detail -> 401',
      (await call(`/admin/users/${userA.id}`)).status === 401
    );
    check(
      'anonymous status mutation -> 401',
      (
        await call(`/admin/users/${userA.id}/status`, {
          method: 'PATCH',
          body: { status: 'SUSPENDED' },
        })
      ).status === 401
    );
    check(
      'anonymous role mutation -> 401',
      (
        await call(`/admin/users/${userA.id}/role`, {
          method: 'PATCH',
          body: { role: 'ADMIN' },
        })
      ).status === 401
    );

    console.log('\n5. USER access -> 403');
    check('USER list -> 403', (await call('/admin/users', { token: userA.token })).status === 403);
    check(
      'USER detail -> 403',
      (await call(`/admin/users/${userB.id}`, { token: userA.token })).status === 403
    );
    check(
      'USER status mutation -> 403',
      (
        await call(`/admin/users/${userB.id}/status`, {
          method: 'PATCH',
          token: userA.token,
          body: { status: 'SUSPENDED' },
        })
      ).status === 403
    );
    check(
      'USER role mutation -> 403',
      (
        await call(`/admin/users/${userB.id}/role`, {
          method: 'PATCH',
          token: userA.token,
          body: { role: 'ADMIN' },
        })
      ).status === 403
    );

    console.log('\n6. ADMIN lists users');
    const list = await call('/admin/users', { token: admin.token });
    check('ADMIN list -> 200', list.status === 200);
    check('list has users array', Array.isArray(list.body.data?.users));
    check('list has pagination meta', typeof list.body.data?.total === 'number');
    check('list includes at least 3 users', (list.body.data?.users?.length ?? 0) >= 3);
    check('list reports page 1', list.body.data?.page === 1);
    const listItem = list.body.data?.users?.[0] ?? {};
    check(
      'list item exposes only safe fields',
      JSON.stringify(Object.keys(listItem).sort()) ===
        JSON.stringify(
          [
            'createdAt',
            'email',
            'firstName',
            'id',
            'lastLoginAt',
            'lastName',
            'role',
            'status',
            'updatedAt',
          ].sort()
        ),
      Object.keys(listItem)
    );

    console.log('\n7. search works');
    const searchEmail = await call(
      `/admin/users?search=${encodeURIComponent(userA.email)}`,
      { token: admin.token }
    );
    check('search by email -> 200', searchEmail.status === 200);
    check('search by email returns exactly 1', searchEmail.body.data?.users?.length === 1);
    check(
      'search returns the right user',
      searchEmail.body.data?.users?.[0]?.id === userA.id
    );
    const searchName = await call('/admin/users?search=E2E', { token: admin.token });
    check('search by name returns matches', (searchName.body.data?.users?.length ?? 0) >= 3);

    console.log('\n8. role filter works');
    const adminsOnly = await call('/admin/users?role=ADMIN', { token: admin.token });
    check('role=ADMIN -> 200', adminsOnly.status === 200);
    check(
      'role=ADMIN returns only admins',
      (adminsOnly.body.data?.users ?? []).every((u: Json) => u.role === 'ADMIN')
    );
    check(
      'role=ADMIN includes the E2E admin',
      (adminsOnly.body.data?.users ?? []).some((u: Json) => u.id === admin.id)
    );
    const usersOnly = await call('/admin/users?role=USER', { token: admin.token });
    check(
      'role=USER returns only users',
      (usersOnly.body.data?.users ?? []).every((u: Json) => u.role === 'USER')
    );
    check(
      'role=USER includes user A',
      (usersOnly.body.data?.users ?? []).some((u: Json) => u.id === userA.id)
    );

    console.log('\n9. status filter works');
    const activeOnly = await call('/admin/users?status=ACTIVE', { token: admin.token });
    check('status=ACTIVE -> 200', activeOnly.status === 200);
    check(
      'status=ACTIVE returns only active users',
      (activeOnly.body.data?.users ?? []).every((u: Json) => u.status === 'ACTIVE')
    );
    const badPageSize = await call('/admin/users?pageSize=51', { token: admin.token });
    check('pageSize > 50 rejected with 400', badPageSize.status === 400);
    const badQuery = await call('/admin/users?foo=bar', { token: admin.token });
    check('unexpected query parameter rejected with 400', badQuery.status === 400);

    console.log('\n10. admin views USER A');
    const detail = await call(`/admin/users/${userA.id}`, { token: admin.token });
    check('admin detail -> 200', detail.status === 200);
    check('detail returns the target user', detail.body.data?.user?.id === userA.id);
    check('detail has counts object', typeof detail.body.data?.counts === 'object');
    check(
      'detail counts include transactions and goals',
      typeof detail.body.data?.counts?.transactions === 'number' &&
        typeof detail.body.data?.counts?.goals === 'number'
    );
    const missing = await call('/admin/users/cmissinguser000000000000', {
      token: admin.token,
    });
    check('nonexistent user -> 404', missing.status === 404);

    console.log('\n11. admin suspends USER A');
    const suspendA = await call(`/admin/users/${userA.id}/status`, {
      method: 'PATCH',
      token: admin.token,
      body: { status: 'SUSPENDED' },
    });
    check('suspend USER A -> 200', suspendA.status === 200);
    check('response reports SUSPENDED', suspendA.body.data?.user?.status === 'SUSPENDED');
    const suspendedFilter = await call('/admin/users?status=SUSPENDED', {
      token: admin.token,
    });
    check(
      'status filter finds suspended user A',
      (suspendedFilter.body.data?.users ?? []).some((u: Json) => u.id === userA.id)
    );

    console.log('\n12. USER A is blocked');
    const blockedAccess = await call('/users/me', { token: userA.token });
    check('suspended user API access -> 403', blockedAccess.status === 403);
    check(
      'suspended user error code',
      blockedAccess.body.error?.code === 'ACCOUNT_SUSPENDED',
      blockedAccess.body.error
    );
    const suspendedLogin = await call('/auth/login', {
      method: 'POST',
      body: { email: userA.email, password: PASSWORD },
    });
    check('suspended user cannot log in -> 403', suspendedLogin.status === 403);
    const suspendedRefresh = await call('/auth/refresh', {
      method: 'POST',
      cookie: userA.cookie,
    });
    check('suspended user refresh -> 401', suspendedRefresh.status === 401, {
      status: suspendedRefresh.status,
      code: suspendedRefresh.body.error?.code ?? suspendedRefresh.body.message,
      hasCookie: Boolean(userA.cookie),
    });
    check(
      'suspended user refresh error code',
      suspendedRefresh.body.error?.code === 'TOKEN_REVOKED',
      suspendedRefresh.body.error
    );
    const openSessions = await prisma.session.count({
      where: { userId: userA.id, revokedAt: null },
    });
    check('all sessions revoked for suspended user', openSessions === 0, openSessions);

    console.log('\n13. admin reactivates USER A');
    const reactivateA = await call(`/admin/users/${userA.id}/status`, {
      method: 'PATCH',
      token: admin.token,
      body: { status: 'ACTIVE' },
    });
    check('reactivate USER A -> 200', reactivateA.status === 200);
    check('response reports ACTIVE', reactivateA.body.data?.user?.status === 'ACTIVE');
    const reactivatedAccess = await call('/users/me', { token: userA.token });
    check('reactivated user can access the API again', reactivatedAccess.status === 200);
    const reactivatedLogin = await call('/auth/login', {
      method: 'POST',
      body: { email: userA.email, password: PASSWORD },
    });
    check('reactivated user can log in again', reactivatedLogin.status === 200);

    console.log('\n14. admin deactivates USER B');
    const deactivateB = await call(`/admin/users/${userB.id}/status`, {
      method: 'PATCH',
      token: admin.token,
      body: { status: 'DEACTIVATED' },
    });
    check('deactivate USER B -> 200', deactivateB.status === 200);
    check(
      'response reports DEACTIVATED',
      deactivateB.body.data?.user?.status === 'DEACTIVATED'
    );

    console.log('\n15. USER B remains blocked');
    const blockedB = await call('/users/me', { token: userB.token });
    check('deactivated user API access -> 403', blockedB.status === 403);
    check(
      'deactivated user error code',
      blockedB.body.error?.code === 'ACCOUNT_DEACTIVATED',
      blockedB.body.error
    );
    const deactivatedLogin = await call('/auth/login', {
      method: 'POST',
      body: { email: userB.email, password: PASSWORD },
    });
    check('deactivated user cannot log in -> 403', deactivatedLogin.status === 403);
    const deactivatedRefresh = await call('/auth/refresh', {
      method: 'POST',
      cookie: userB.cookie,
    });
    check('deactivated user refresh -> 401', deactivatedRefresh.status === 401, {
      status: deactivatedRefresh.status,
      code: deactivatedRefresh.body.error?.code ?? deactivatedRefresh.body.message,
      hasCookie: Boolean(userB.cookie),
    });
    const openSessionsB = await prisma.session.count({
      where: { userId: userB.id, revokedAt: null },
    });
    check('all sessions revoked for deactivated user', openSessionsB === 0, openSessionsB);

    console.log('\n16. role management');
    const promoteB = await call(`/admin/users/${userB.id}/role`, {
      method: 'PATCH',
      token: admin.token,
      body: { role: 'ADMIN' },
    });
    check('promote USER B -> 200', promoteB.status === 200);
    check('response reports ADMIN role', promoteB.body.data?.user?.role === 'ADMIN');
    const demoteB = await call(`/admin/users/${userB.id}/role`, {
      method: 'PATCH',
      token: admin.token,
      body: { role: 'USER' },
    });
    check('demote USER B back -> 200', demoteB.status === 200);
    check('response reports USER role', demoteB.body.data?.user?.role === 'USER');
    const userSelfPromote = await call(`/admin/users/${userA.id}/role`, {
      method: 'PATCH',
      token: userA.token,
      body: { role: 'ADMIN' },
    });
    check('USER cannot promote self -> 403', userSelfPromote.status === 403);
    const massAssignment = await call(`/admin/users/${userA.id}/status`, {
      method: 'PATCH',
      token: admin.token,
      body: { status: 'ACTIVE', role: 'ADMIN', userId: userA.id },
    });
    check('status body mass assignment rejected -> 400', massAssignment.status === 400);

    console.log('\n17. self-suspension rejected');
    const selfSuspend = await call(`/admin/users/${admin.id}/status`, {
      method: 'PATCH',
      token: admin.token,
      body: { status: 'SUSPENDED' },
    });
    check('admin cannot suspend self -> 409', selfSuspend.status === 409);
    check(
      'self-suspension error code',
      selfSuspend.body.error?.code === 'ADMIN_SELF_STATUS_CHANGE',
      selfSuspend.body.error
    );

    console.log('\n18. self-deactivation rejected');
    const selfDeactivate = await call(`/admin/users/${admin.id}/status`, {
      method: 'PATCH',
      token: admin.token,
      body: { status: 'DEACTIVATED' },
    });
    check('admin cannot deactivate self -> 409', selfDeactivate.status === 409);
    check(
      'self-deactivation error code',
      selfDeactivate.body.error?.code === 'ADMIN_SELF_STATUS_CHANGE',
      selfDeactivate.body.error
    );

    console.log('\n19. last-admin protection works');
    const activeAdmins = await prisma.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE' },
    });
    if (activeAdmins === 1) {
      const selfDemote = await call(`/admin/users/${admin.id}/role`, {
        method: 'PATCH',
        token: admin.token,
        body: { role: 'USER' },
      });
      check('last admin cannot demote self -> 409', selfDemote.status === 409);
      check(
        'last-admin error code',
        selfDemote.body.error?.code === 'LAST_ADMIN_REQUIRED',
        selfDemote.body.error
      );
      const stillAdmin = await prisma.user.findUnique({ where: { id: admin.id } });
      check('admin role unchanged after rejection', stillAdmin?.role === 'ADMIN');
    } else {
      const selfDemote = await call(`/admin/users/${admin.id}/role`, {
        method: 'PATCH',
        token: admin.token,
        body: { role: 'USER' },
      });
      check(
        'demotion allowed while other administrators exist -> 200',
        selfDemote.status === 200,
        selfDemote.body
      );
      await prisma.user.update({
        where: { id: admin.id },
        data: { role: 'ADMIN' },
      });
      const remaining = await prisma.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE' },
      });
      check('at least one administrator always remains', remaining >= 1, remaining);
    }

    console.log('\n20. spoofed role/header attempts fail');
    const spoofedRole = await fetch(`${BASE_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${userA.token}`, 'X-User-Role': 'ADMIN' },
    });
    check('USER with X-User-Role: ADMIN -> 403', spoofedRole.status === 403);
    const spoofedId = await fetch(`${BASE_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${userA.token}`, 'X-User-Id': admin.id },
    });
    check('USER with X-User-Id: admin -> 403', spoofedId.status === 403);
    const spoofedQuery = await fetch(`${BASE_URL}/admin/users?role=ADMIN`, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    check('USER with ?role=ADMIN -> 403', spoofedQuery.status === 403);

    console.log('\n21. no credentials appear in responses');
    const listRaw = JSON.stringify(list.body);
    const detailRaw = JSON.stringify(detail.body);
    const allRaw = listRaw + detailRaw;
    check('no passwordHash in responses', !allRaw.includes('passwordHash'));
    check('no refreshTokenHash in responses', !allRaw.includes('refreshTokenHash'));
    check(
      'no previousRefreshTokenHash in responses',
      !allRaw.includes('previousRefreshTokenHash')
    );
    check('no tokenHash in responses', !allRaw.includes('tokenHash'));
    check('no password field in responses', !allRaw.includes('"password"'));

    console.log('\n22. no financial amounts appear in admin user responses');
    check('no seeded amount 4321.99', !detailRaw.includes('4321.99'));
    check('no seeded amount 8765.43', !detailRaw.includes('8765.43'));
    check('no seeded targetAmount value', !detailRaw.includes('9999.99'));
    check('no amount key in responses', !detailRaw.includes('"amount"'));

    console.log('\n23. existing financial records remain intact');
    const recordsAfter = {
      transactions: await prisma.transaction.count({ where: { userId: userA.id } }),
      goals: await prisma.savingsGoal.count({ where: { userId: userA.id } }),
      assets: await prisma.asset.count({ where: { userId: userA.id } }),
      liabilities: await prisma.liability.count({ where: { userId: userA.id } }),
      habits: await prisma.financialHabit.count({ where: { userId: userA.id } }),
    };
    check(
      'financial records unchanged by status changes',
      JSON.stringify(recordsBefore) === JSON.stringify(recordsAfter),
      { before: recordsBefore, after: recordsAfter }
    );
  } finally {
    try {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      console.log('\n24. cleanup: removed the throwaway E2E users and audit entries');
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
    console.log('E2E admin users: PASS');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\nE2E admin users: ERROR\n${String(error)}`);
    process.exit(1);
  });
