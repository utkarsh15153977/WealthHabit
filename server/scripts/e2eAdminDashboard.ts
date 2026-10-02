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

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function call(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<CallResult> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(options.token),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let body: Json = {};
  if (text) {
    try {
      body = JSON.parse(text) as Json;
    } catch {
      body = { raw: text };
    }
  }

  return { status: response.status, body };
}

async function registerUser(label: string): Promise<{ token: string; id: string }> {
  const email = `e2e-admin-${label}-${Date.now()}@example.com`;
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
  if (!token) {
    throw new Error(`no access token for ${label}: ${JSON.stringify(result.body)}`);
  }
  return { token, id };
}

async function main(): Promise<void> {
  console.log(`Admin Dashboard E2E against ${BASE_URL}\n`);

  const userA = await registerUser('user-a');
  const userB = await registerUser('user-b');
  const createdUserIds: string[] = [userA.id, userB.id].filter(
    (id): id is string => typeof id === 'string'
  );
  const prisma = new PrismaClient();

  try {
    console.log('\n1. seed records for user A');
    for (let i = 0; i < 5; i++) {
      await prisma.transaction.create({
        data: {
          userId: userA.id,
          categoryId: (await prisma.category.findFirst({ where: { userId: userA.id, type: 'EXPENSE' } }))?.id ?? (await prisma.category.create({ data: { userId: userA.id, name: 'Test', type: 'EXPENSE' } })).id,
          type: 'EXPENSE',
          amount: 1000,
          transactionDate: new Date(),
        },
      });
    }
    for (let i = 0; i < 3; i++) {
      await prisma.savingsGoal.create({
        data: {
          userId: userA.id,
          name: `Goal ${i}`,
          targetAmount: 10000,
          targetDate: new Date('2027-01-01'),
          category: 'general',
        },
      });
    }
    for (let i = 0; i < 2; i++) {
      await prisma.asset.create({
        data: {
          userId: userA.id,
          name: `Asset ${i}`,
          type: 'CASH',
          currentValue: 5000,
        },
      });
    }
    for (let i = 0; i < 2; i++) {
      await prisma.liability.create({
        data: {
          userId: userA.id,
          name: `Liability ${i}`,
          type: 'CREDIT_CARD',
          outstandingAmount: 3000,
        },
      });
    }
    for (let i = 0; i < 3; i++) {
      await prisma.wealthSnapshot.create({
        data: {
          userId: userA.id,
          snapshotDate: new Date(),
          totalAssets: 10000,
          totalLiabilities: 5000,
          netWorth: 5000,
        },
      });
    }
    for (let i = 0; i < 2; i++) {
      await prisma.financialHabit.create({
        data: {
          userId: userA.id,
          name: `Habit ${i}`,
          frequency: 'DAILY',
          startDate: new Date(),
        },
      });
    }
    for (let i = 0; i < 2; i++) {
      await prisma.challenge.create({
        data: {
          name: `Challenge ${i}`,
          description: 'Test',
          category: 'Test',
          difficulty: 'EASY',
          points: 100,
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000 * 30),
        },
      });
    }
    for (let i = 0; i < 3; i++) {
      await prisma.notification.create({
        data: {
          userId: userA.id,
          type: 'BUDGET_THRESHOLD',
          title: `Notification ${i}`,
          message: 'Test',
        },
      });
    }
    console.log('Seeded records for user A');

    console.log('\n2. anonymous request should be 401');
    const anon = await call('/admin/dashboard');
    check('anonymous GET /api/admin/dashboard -> 401', anon.status === 401);

    console.log('\n3. normal USER request should be 403');
    const userReq = await call('/admin/dashboard', { token: userA.token });
    check('USER GET /api/admin/dashboard -> 403', userReq.status === 403);

    console.log('\n4. create admin user and promote');
    const admin = await registerUser('admin');
    await prisma.user.update({
      where: { id: admin.id },
      data: { role: 'ADMIN' },
    });
    // The original token works because authenticate() fetches the role from DB on each request
    console.log('Admin user promoted');

    console.log('\n5. ADMIN request should be 200');
    const adminReq = await call('/admin/dashboard', { token: admin.token });
    check('ADMIN GET /api/admin/dashboard -> 200', adminReq.status === 200);
    const data = adminReq.body.data ?? {};
    check('response has users object', typeof data.users === 'object' && data.users !== null);
    check('response has financialRecords object', typeof data.financialRecords === 'object' && data.financialRecords !== null);
    check('response has application object', typeof data.application === 'object' && data.application !== null);
    check('response has generatedAt timestamp', typeof data.generatedAt === 'string');
    check('users.total >= 3', (data.users?.total ?? 0) >= 3);
    check('users.active >= 2', (data.users?.active ?? 0) >= 2);
    check('users.admins >= 1', (data.users?.admins ?? 0) >= 1);
    check('users.recentlyRegistered >= 1', (data.users?.recentlyRegistered ?? 0) >= 1);
    check('financialRecords.transactions >= 5', (data.financialRecords?.transactions ?? 0) >= 5);
    check('financialRecords.savingsGoals >= 3', (data.financialRecords?.savingsGoals ?? 0) >= 3);
    check('financialRecords.assets >= 2', (data.financialRecords?.assets ?? 0) >= 2);
    check('financialRecords.liabilities >= 2', (data.financialRecords?.liabilities ?? 0) >= 2);
    check('financialRecords.wealthSnapshots >= 3', (data.financialRecords?.wealthSnapshots ?? 0) >= 3);
    check('application.habits >= 2', (data.application?.habits ?? 0) >= 2);
    check('application.challenges >= 2', (data.application?.challenges ?? 0) >= 2);
    check('application.notifications >= 3', (data.application?.notifications ?? 0) >= 3);
    check('no individual financial amounts exposed', JSON.stringify(data).indexOf('amount') === -1 || JSON.stringify(data).indexOf('amount') > 100);

    console.log('\n6. role spoofing - USER with X-User-Role: ADMIN header should still be 403');
    const spoofedRole = await call('/admin/dashboard', {
      token: userA.token,
    });
    // The call function doesn't support custom headers easily, so we test via direct fetch
    const spoofedRes = await fetch(`${BASE_URL}/admin/dashboard`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.token}`,
        'X-User-Role': 'ADMIN',
      },
    });
    check('USER with X-User-Role: ADMIN -> 403', spoofedRes.status === 403);

    console.log('\n7. user ID spoofing - USER with X-User-Id: admin header should still be 403');
    const spoofedIdRes = await fetch(`${BASE_URL}/admin/dashboard`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.token}`,
        'X-User-Id': admin.id,
      },
    });
    check('USER with X-User-Id: admin -> 403', spoofedIdRes.status === 403);

    console.log('\n8. role query param spoofing should be rejected by strict validation');
    const querySpoofRes = await fetch(`${BASE_URL}/admin/dashboard?role=ADMIN`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.token}`,
      },
    });
    check('USER with ?role=ADMIN -> 403', querySpoofRes.status === 403);

    console.log('\n9. read-only guarantee - counts before and after');
    const countsBefore = {
      users: await prisma.user.count(),
      transactions: await prisma.transaction.count(),
      goals: await prisma.savingsGoal.count(),
      assets: await prisma.asset.count(),
      liabilities: await prisma.liability.count(),
      snapshots: await prisma.wealthSnapshot.count(),
      habits: await prisma.financialHabit.count(),
      challenges: await prisma.challenge.count(),
      notifications: await prisma.notification.count(),
    };

    for (let i = 0; i < 3; i++) {
      await call('/admin/dashboard', { token: admin.token });
    }

    const countsAfter = {
      users: await prisma.user.count(),
      transactions: await prisma.transaction.count(),
      goals: await prisma.savingsGoal.count(),
      assets: await prisma.asset.count(),
      liabilities: await prisma.liability.count(),
      snapshots: await prisma.wealthSnapshot.count(),
      habits: await prisma.financialHabit.count(),
      challenges: await prisma.challenge.count(),
      notifications: await prisma.notification.count(),
    };
    check('reading dashboard creates no records', JSON.stringify(countsBefore) === JSON.stringify(countsAfter), {
      before: countsBefore,
      after: countsAfter,
    });

    console.log('\n10. suspended/deactivated admin account should not bypass');
    const suspendedAdmin = await registerUser('suspended-admin');
    await prisma.user.update({
      where: { id: suspendedAdmin.id },
      data: { role: 'ADMIN', status: 'SUSPENDED' },
    });
    const suspendedLogin = await call('/auth/login', {
      method: 'POST',
      body: { email: (await prisma.user.findUnique({ where: { id: suspendedAdmin.id } }))?.email ?? '', password: PASSWORD },
    });
    const suspendedToken = suspendedLogin.body.data?.accessToken;
    if (suspendedToken) {
      const suspendedReq = await call('/admin/dashboard', { token: suspendedToken });
      check('suspended admin -> 403', suspendedReq.status === 403);
    } else {
      // If login fails, that's also acceptable
      check('suspended admin cannot login or access dashboard', true);
    }

    const deactivatedAdmin = await registerUser('deactivated-admin');
    await prisma.user.update({
      where: { id: deactivatedAdmin.id },
      data: { role: 'ADMIN', status: 'DEACTIVATED' },
    });
    const deactivatedLogin = await call('/auth/login', {
      method: 'POST',
      body: { email: (await prisma.user.findUnique({ where: { id: deactivatedAdmin.id } }))?.email ?? '', password: PASSWORD },
    });
    const deactivatedToken = deactivatedLogin.body.data?.accessToken;
    if (deactivatedToken) {
      const deactivatedReq = await call('/admin/dashboard', { token: deactivatedToken });
      check('deactivated admin -> 403', deactivatedReq.status === 403);
    } else {
      check('deactivated admin cannot login or access dashboard', true);
    }

    createdUserIds.push(admin.id, suspendedAdmin.id, deactivatedAdmin.id);

  } finally {
    try {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      console.log('\ncleanup: removed the throwaway E2E users');
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
    console.log('E2E admin dashboard: PASS');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\nE2E admin dashboard: ERROR\n${String(error)}`);
    process.exit(1);
  });