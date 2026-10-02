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
    console.error(`  FAIL ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
  }
}

async function call(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<CallResult> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
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
  const email = `e2e-nw-${label}-${Date.now()}@example.com`;
  const result = await call('/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, firstName: 'E2E', lastName: label },
  });
  if (result.status !== 201 && result.status !== 200) {
    throw new Error(`register failed for ${label}: ${result.status} ${JSON.stringify(result.body)}`);
  }
  const token = result.body.data?.accessToken ?? result.body.accessToken;
  const id = result.body.data?.user?.id ?? result.body.user?.id;
  if (!token) {
    throw new Error(`no access token for ${label}: ${JSON.stringify(result.body)}`);
  }
  return { token, id };
}

function todayUtcDay(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString();
}

async function main(): Promise<void> {
  console.log(`Net Worth & Wealth Snapshots E2E against ${BASE_URL}\n`);

  const userA = await registerUser('a');
  const userB = await registerUser('b');
  const createdUserIds: string[] = [userA.id, userB.id].filter(
    (id): id is string => typeof id === 'string'
  );

  try {
    console.log('\n1. transactions and goals that must never affect net worth');
    const category = await call('/categories', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Groceries', type: 'EXPENSE' },
    });
    check('creates a category', category.status === 201, category.body);

    const transaction = await call('/transactions', {
      method: 'POST',
      token: userA.token,
      body: {
        categoryId: category.body.data?.category?.id,
        type: 'EXPENSE',
        amount: '999999.00',
        transactionDate: new Date().toISOString().slice(0, 10),
        description: 'E2E decoy transaction',
      },
    });
    check('creates a decoy transaction', transaction.status === 201, transaction.body);

    const goal = await call('/goals', {
      method: 'POST',
      token: userA.token,
      body: {
        name: 'E2E emergency fund',
        targetAmount: '200000.00',
        targetDate: '2027-01-01',
      },
    });
    check('creates a savings goal', goal.status === 201, goal.body);

    const contribution = await call(
      `/goals/${goal.body.data?.goal?.id}/contributions`,
      { method: 'POST', token: userA.token, body: { amount: '50000.00' } }
    );
    check('creates a goal contribution', contribution.status === 201, contribution.body);

    console.log('\n2. current net worth is derived from assets and liabilities only');
    const cash = await call('/assets', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Cash wallet', currentValue: '5000.00' },
    });
    check('creates an asset', cash.status === 201, cash.body);

    const bank = await call('/assets', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Savings account', type: 'BANK_ACCOUNT', currentValue: '150000.50' },
    });
    check('creates a second asset', bank.status === 201, bank.body);

    const card = await call('/liabilities', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Credit card', outstandingAmount: '35000.00' },
    });
    check('creates a liability', card.status === 201, card.body);

    const summary = await call('/assets-liabilities/summary', { token: userA.token });
    check(
      'net worth equals assets minus liabilities',
      summary.body.data?.totalAssets === 155000.5 &&
        summary.body.data?.totalLiabilities === 35000 &&
        summary.body.data?.netWorth === 120000.5,
      summary.body.data
    );
    check(
      'the decoy transaction and goal contribution never enter net worth',
      summary.body.data?.netWorth === 120000.5 && summary.body.data?.assetCount === 2,
      summary.body.data
    );

    const emptyUserSummary = await call('/assets-liabilities/summary', {
      token: userB.token,
    });
    check(
      'a user with liabilities only gets a negative net worth',
      emptyUserSummary.body.data?.totalAssets === 0 &&
        emptyUserSummary.body.data?.totalLiabilities === 0,
      emptyUserSummary.body.data
    );
    const loneLiability = await call('/liabilities', {
      method: 'POST',
      token: userB.token,
      body: { name: 'E2E Student loan', outstandingAmount: '40000.00' },
    });
    check('creates a liability for user B', loneLiability.status === 201, loneLiability.body);
    const negativeSummary = await call('/assets-liabilities/summary', { token: userB.token });
    check(
      'negative net worth is returned, not clamped',
      negativeSummary.body.data?.netWorth === -40000,
      negativeSummary.body.data
    );

    console.log('\n3. capture a snapshot');
    const firstCapture = await call('/wealth-snapshots', {
      method: 'POST',
      token: userA.token,
      body: {},
    });
    check('captures a snapshot with 201', firstCapture.status === 201, firstCapture.body);
    check(
      'reports the snapshot as newly created',
      firstCapture.body.data?.created === true,
      firstCapture.body.data
    );
    const snapshot = firstCapture.body.data?.snapshot ?? {};
    const snapshotKeys = Object.keys(snapshot).sort().join(',');
    check(
      'exposes only id, snapshotDate and the three money fields',
      snapshotKeys === 'id,netWorth,snapshotDate,totalAssets,totalLiabilities',
      snapshotKeys
    );
    check(
      'stores the figures captured at that moment',
      snapshot.totalAssets === 155000.5 &&
        snapshot.totalLiabilities === 35000 &&
        snapshot.netWorth === 120000.5,
      snapshot
    );
    check('stores today as a UTC calendar day', snapshot.snapshotDate === todayUtcDay(), {
      snapshotDate: snapshot.snapshotDate,
      expected: todayUtcDay(),
    });
    check('never exposes userId', snapshot.userId === undefined, snapshot);

    console.log('\n4. same-day capture is idempotent and race safe');
    const secondCapture = await call('/wealth-snapshots', {
      method: 'POST',
      token: userA.token,
      body: {},
    });
    check('returns 200 for a repeat capture', secondCapture.status === 200, secondCapture.body);
    check(
      'reports the existing snapshot instead of creating one',
      secondCapture.body.data?.created === false &&
        secondCapture.body.data?.snapshot?.id === snapshot.id,
      secondCapture.body.data
    );

    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () =>
        call('/wealth-snapshots', { method: 'POST', token: userB.token, body: {} })
      )
    );
    check(
      'concurrent captures all succeed without a 500',
      concurrent.every((result) => result.status === 200 || result.status === 201),
      concurrent.map((result) => result.status)
    );
    check(
      'exactly one snapshot row survives the race',
      concurrent.filter((result) => result.status === 201).length === 1,
      concurrent.map((result) => result.status)
    );

    const bList = await call('/wealth-snapshots', { token: userB.token });
    check('user B has exactly one snapshot', bList.body.data?.total === 1, bList.body.data);
    check(
      'user B snapshot keeps the negative net worth',
      bList.body.data?.snapshots?.[0]?.netWorth === -40000,
      bList.body.data
    );

    console.log('\n5. snapshots are immutable');
    const patched = await call(`/assets/${bank.body.data?.asset?.id}`, {
      method: 'PATCH',
      token: userA.token,
      body: { currentValue: '175000.00' },
    });
    check('updates the asset after capture', patched.status === 200, patched.body);

    const summaryAfter = await call('/assets-liabilities/summary', { token: userA.token });
    check(
      'the live net worth moved to the new balance',
      summaryAfter.body.data?.totalAssets === 180000 &&
        summaryAfter.body.data?.netWorth === 145000,
      summaryAfter.body.data
    );

    const reread = await call(`/wealth-snapshots/${snapshot.id}`, { token: userA.token });
    check(
      'the stored snapshot still holds the captured values',
      reread.body.data?.snapshot?.totalAssets === 155000.5 &&
        reread.body.data?.snapshot?.netWorth === 120000.5,
      reread.body.data
    );

    const deleteRoute = await call(`/wealth-snapshots/${snapshot.id}`, {
      method: 'DELETE',
      token: userA.token,
    });
    check('no delete route exists for snapshots', deleteRoute.status === 404, deleteRoute.body);
    const afterDeleteAttempt = await call(`/wealth-snapshots/${snapshot.id}`, {
      token: userA.token,
    });
    check('the snapshot survived the delete attempt', afterDeleteAttempt.status === 200);

    console.log('\n6. listing, paging and ownership');
    const list = await call('/wealth-snapshots', { token: userA.token });
    check('lists exactly one snapshot', list.body.data?.total === 1, list.body.data);
    check(
      'returns list metadata',
      list.body.data?.page === 1 && list.body.data?.pageSize === 20,
      list.body.data
    );

    const paged = await call('/wealth-snapshots?page=1&pageSize=1', { token: userA.token });
    check('honours a pageSize of 1', paged.body.data?.snapshots?.length === 1, paged.body.data);

    const invalidPage = await call('/wealth-snapshots?pageSize=500', { token: userA.token });
    check('rejects a pageSize above 50', invalidPage.status === 400, invalidPage.body);

    const massAssigned = await call('/wealth-snapshots', {
      method: 'POST',
      token: userA.token,
      body: { userId: userB.id, netWorth: 999999, snapshotDate: '2020-01-01' },
    });
    check(
      'rejects client supplied snapshot fields',
      massAssigned.status === 400,
      massAssigned.body
    );

    const foreignRead = await call(`/wealth-snapshots/${snapshot.id}`, {
      token: userB.token,
    });
    check('another user cannot read my snapshot', foreignRead.status === 404, foreignRead.body);
    check(
      'foreign read returns WEALTH_SNAPSHOT_NOT_FOUND',
      foreignRead.body?.error?.code === 'WEALTH_SNAPSHOT_NOT_FOUND',
      foreignRead.body
    );

    const unauthorized = await call('/wealth-snapshots');
    check('rejects anonymous requests', unauthorized.status === 401, unauthorized.body);
    const unauthorizedPost = await call('/wealth-snapshots', { method: 'POST', body: {} });
    check('rejects anonymous capture', unauthorizedPost.status === 401, unauthorizedPost.body);

    console.log('\n7. records are not disturbed by net worth work');
    const transactions = await call('/transactions', { token: userA.token });
    check(
      'no transactions were created by capturing a snapshot',
      (transactions.body.data?.transactions ?? []).length === 1,
      transactions.body.data
    );
    const notifications = await call('/notifications', { token: userA.token });
    check(
      'no asset or snapshot notifications were generated',
      (notifications.body.data?.notifications ?? []).filter((item: Json) => {
        const type = String(item.type ?? '').toUpperCase();
        return type.includes('ASSET') || type.includes('SNAPSHOT');
      }).length === 0,
      notifications.body.data
    );
  } finally {
    const prisma = new PrismaClient();
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
    console.log('E2E net worth: PASS');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\nE2E net worth: ERROR\n${String(error)}`);
    process.exit(1);
  });
