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
  const email = `e2e-wa-${label}-${Date.now()}@example.com`;
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

function utcDaysAgo(days: number): string {
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  return new Date(today.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function dayOnly(daysAgo: number): string {
  return utcDaysAgo(daysAgo).slice(0, 10);
}

async function main(): Promise<void> {
  console.log(`Wealth Analytics E2E against ${BASE_URL}\n`);

  const userA = await registerUser('a');
  const userB = await registerUser('b');
  const createdUserIds: string[] = [userA.id, userB.id].filter(
    (id): id is string => typeof id === 'string'
  );
  const prisma = new PrismaClient();

  try {
    console.log('\n1. seed authoritative records for user A');
    const incomeCategory = await call('/categories', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Salary', type: 'INCOME' },
    });
    check('creates an income category', incomeCategory.status === 201, incomeCategory.body);
    const incomeCategoryId = incomeCategory.body.data?.category?.id as string;

    const foodCategory = await call('/categories', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Food', type: 'EXPENSE' },
    });
    check('creates an expense category', foodCategory.status === 201, foodCategory.body);
    const foodCategoryId = foodCategory.body.data?.category?.id as string;

    const rentCategory = await call('/categories', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Rent', type: 'EXPENSE' },
    });
    check('creates a second expense category', rentCategory.status === 201, rentCategory.body);
    const rentCategoryId = rentCategory.body.data?.category?.id as string;

    const incomeRecent = await call('/transactions', {
      method: 'POST',
      token: userA.token,
      body: {
        categoryId: incomeCategoryId,
        type: 'INCOME',
        amount: '100000.00',
        transactionDate: dayOnly(10),
      },
    });
    check('creates a recent income transaction', incomeRecent.status === 201, incomeRecent.body);

    const incomeOld = await call('/transactions', {
      method: 'POST',
      token: userA.token,
      body: {
        categoryId: incomeCategoryId,
        type: 'INCOME',
        amount: '50000.00',
        transactionDate: dayOnly(200),
      },
    });
    check('creates an older income transaction', incomeOld.status === 201, incomeOld.body);

    const foodExpense = await call('/transactions', {
      method: 'POST',
      token: userA.token,
      body: {
        categoryId: foodCategoryId,
        type: 'EXPENSE',
        amount: '40000.00',
        transactionDate: dayOnly(5),
      },
    });
    check('creates a food expense', foodExpense.status === 201, foodExpense.body);

    const rentExpense = await call('/transactions', {
      method: 'POST',
      token: userA.token,
      body: {
        categoryId: rentCategoryId,
        type: 'EXPENSE',
        amount: '30000.00',
        transactionDate: dayOnly(3),
      },
    });
    check('creates a rent expense', rentExpense.status === 201, rentExpense.body);

    const cash = await call('/assets', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Cash wallet', type: 'CASH', currentValue: '5000.00' },
    });
    check('creates a cash asset', cash.status === 201, cash.body);

    const bank = await call('/assets', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Savings account', type: 'BANK_ACCOUNT', currentValue: '150000.50' },
    });
    check('creates a bank asset', bank.status === 201, bank.body);

    const card = await call('/liabilities', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Credit card', type: 'CREDIT_CARD', outstandingAmount: '35000.00' },
    });
    check('creates a liability', card.status === 201, card.body);

    const activeGoal = await call('/goals', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Emergency fund', targetAmount: '200000.00', targetDate: '2027-01-01' },
    });
    check('creates an active savings goal', activeGoal.status === 201, activeGoal.body);
    const activeGoalId = activeGoal.body.data?.goal?.id as string;

    const activeContribution = await call(`/goals/${activeGoalId}/contributions`, {
      method: 'POST',
      token: userA.token,
      body: { amount: '50000.00' },
    });
    check('contributes to the active goal', activeContribution.status === 201, activeContribution.body);

    const completedGoal = await call('/goals', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Laptop', targetAmount: '10000.00', targetDate: '2027-01-01' },
    });
    check('creates a second savings goal', completedGoal.status === 201, completedGoal.body);
    const completedGoalId = completedGoal.body.data?.goal?.id as string;

    const completedContribution = await call(`/goals/${completedGoalId}/contributions`, {
      method: 'POST',
      token: userA.token,
      body: { amount: '10000.00' },
    });
    check('contributes to the second goal', completedContribution.status === 201, completedContribution.body);

    console.log('\n2. capture a wealth snapshot and backfill one historical snapshot');
    const capture = await call('/wealth-snapshots', {
      method: 'POST',
      token: userA.token,
      body: {},
    });
    check('captures today’s snapshot', capture.status === 201 || capture.status === 200, capture.body);
    check(
      'the captured snapshot holds the live net worth',
      capture.body.data?.snapshot?.totalAssets === 155000.5 &&
        capture.body.data?.snapshot?.totalLiabilities === 35000 &&
        capture.body.data?.snapshot?.netWorth === 120000.5,
      capture.body.data
    );

    const backdatedSnapshot = await prisma.wealthSnapshot.create({
      data: {
        userId: userA.id,
        snapshotDate: new Date(utcDaysAgo(30)),
        totalAssets: 100000,
        totalLiabilities: 20000,
        netWorth: 80000,
      },
    });
    check('inserts a backdated snapshot for history', Boolean(backdatedSnapshot.id));

    console.log('\n3. current summary and goal analytics');
    const summaryBefore = await call('/wealth-analytics/summary', { token: userA.token });
    check('summary responds 200', summaryBefore.status === 200, summaryBefore.body);
    const current = summaryBefore.body.data?.current ?? {};
    check(
      'current position equals live assets minus liabilities',
      current.totalAssets === 155000.5 &&
        current.totalLiabilities === 35000 &&
        current.netWorth === 120000.5 &&
        current.assetCount === 2 &&
        current.liabilityCount === 1,
      current
    );
    const goals = summaryBefore.body.data?.goals ?? {};
    check(
      'reports active and completed goal counts',
      goals.goalCount === 2 && goals.activeCount === 1 && goals.completedCount === 1,
      goals
    );
    check(
      'reports goal totals and capped overall progress',
      goals.totalTargetAmount === 210000 &&
        goals.totalSavedAmount === 60000 &&
        goals.progressPercent === 28.57,
      goals
    );
    check(
      'returns a goal breakdown with derived progress',
      Array.isArray(goals.items) &&
        goals.items.length === 2 &&
        goals.items.every((item: Json) => typeof item.progressPercent === 'number'),
      goals.items
    );

    const phase5c = await call('/assets-liabilities/summary', { token: userA.token });
    check(
      'analytics current position matches the Phase 5C summary exactly',
      phase5c.body.data?.totalAssets === current.totalAssets &&
        phase5c.body.data?.netWorth === current.netWorth,
      { analytics: current, phase5c: phase5c.body.data }
    );

    console.log('\n4. net worth history, change and date filtering');
    const history = await call('/wealth-analytics/net-worth', { token: userA.token });
    check('history responds 200', history.status === 200, history.body);
    const historyPoints = history.body.data?.history ?? [];
    check('returns both stored snapshots', historyPoints.length === 2, historyPoints);
    check(
      'orders history chronologically with stored values',
      historyPoints[0]?.netWorth === 80000 &&
        historyPoints[0]?.totalAssets === 100000 &&
        historyPoints[1]?.netWorth === 120000.5,
      historyPoints
    );
    check(
      'derives net worth change as latest minus earliest',
      history.body.data?.change?.absolute === 40000.5 &&
        history.body.data?.change?.percentage === 50,
      history.body.data?.change
    );

    const narrowed = await call(
      `/wealth-analytics/net-worth?dateFrom=${encodeURIComponent(utcDaysAgo(7))}`,
      { token: userA.token }
    );
    check(
      'filters history by date and never interpolates',
      (narrowed.body.data?.history ?? []).length === 1,
      narrowed.body.data?.history
    );
    check(
      'a single remaining snapshot has no meaningful change',
      narrowed.body.data?.change?.absolute === null &&
        narrowed.body.data?.change?.percentage === null,
      narrowed.body.data?.change
    );

    const reversedRange = await call(
      `/wealth-analytics/net-worth?dateFrom=${encodeURIComponent(utcDaysAgo(1))}&dateTo=${encodeURIComponent(utcDaysAgo(30))}`,
      { token: userA.token }
    );
    check('rejects a reversed date range', reversedRange.status === 400, reversedRange.body);

    const tooWide = await call(
      `/wealth-analytics/net-worth?dateFrom=${encodeURIComponent(utcDaysAgo(3000))}`,
      { token: userA.token }
    );
    check('rejects an unbounded date range', tooWide.status === 400, tooWide.body);

    console.log('\n5. asset allocation and liability composition');
    const assets = await call('/wealth-analytics/assets', { token: userA.token });
    check('assets analytics responds 200', assets.status === 200, assets.body);
    const assetData = assets.body.data ?? {};
    check(
      'totals the live asset position',
      assetData.totalAssets === 155000.5 && assetData.assetCount === 2,
      assetData
    );
    check(
      'groups assets by type with derived percentages',
      assetData.byType?.length === 2 &&
        assetData.byType[0]?.type === 'BANK_ACCOUNT' &&
        assetData.byType[0]?.percentage === 96.77 &&
        assetData.byType[1]?.type === 'CASH' &&
        assetData.byType[1]?.percentage === 3.23,
      assetData.byType
    );
    check(
      'lists every asset with its share',
      assetData.assets?.length === 2 &&
        assetData.assets.every((asset: Json) => typeof asset.percentage === 'number'),
      assetData.assets
    );

    const liabilities = await call('/wealth-analytics/liabilities', { token: userA.token });
    check('liabilities analytics responds 200', liabilities.status === 200, liabilities.body);
    const liabilityData = liabilities.body.data ?? {};
    check(
      'totals the live liability position',
      liabilityData.totalLiabilities === 35000 && liabilityData.liabilityCount === 1,
      liabilityData
    );
    check(
      'reports the liability share by type',
      liabilityData.byType?.length === 1 &&
        liabilityData.byType[0]?.type === 'CREDIT_CARD' &&
        liabilityData.byType[0]?.percentage === 100,
      liabilityData.byType
    );
    check(
      'exposes the outstanding balance of each liability',
      liabilityData.liabilities?.length === 1 &&
        liabilityData.liabilities[0]?.outstandingBalance === 35000,
      liabilityData.liabilities
    );

    console.log('\n6. cash flow and category breakdowns');
    const cashFlowDefault = await call('/wealth-analytics/cash-flow', { token: userA.token });
    check('cash flow responds 200', cashFlowDefault.status === 200, cashFlowDefault.body);
    const cashDefault = cashFlowDefault.body.data ?? {};
    check(
      'sums income, expenses and net cash flow over the default range',
      cashDefault.income === 150000 &&
        cashDefault.expenses === 70000 &&
        cashDefault.net === 80000 &&
        cashDefault.transactionCount === 4,
      cashDefault
    );
    check(
      'breaks income down by category',
      cashDefault.incomeByCategory?.length === 1 &&
        cashDefault.incomeByCategory[0]?.name === 'E2E Salary' &&
        cashDefault.incomeByCategory[0]?.total === 150000 &&
        cashDefault.incomeByCategory[0]?.percentage === 100,
      cashDefault.incomeByCategory
    );
    check(
      'breaks expenses down by category',
      cashDefault.expenseByCategory?.length === 2 &&
        cashDefault.expenseByCategory[0]?.name === 'E2E Food' &&
        cashDefault.expenseByCategory[0]?.total === 40000 &&
        cashDefault.expenseByCategory[0]?.percentage === 57.14 &&
        cashDefault.expenseByCategory[1]?.name === 'E2E Rent' &&
        cashDefault.expenseByCategory[1]?.percentage === 42.86,
      cashDefault.expenseByCategory
    );

    const cashFlowNarrow = await call(
      `/wealth-analytics/cash-flow?dateFrom=${encodeURIComponent(utcDaysAgo(90))}`,
      { token: userA.token }
    );
    const cashNarrow = cashFlowNarrow.body.data ?? {};
    check(
      'filters cash flow by the selected range',
      cashNarrow.income === 100000 &&
        cashNarrow.expenses === 70000 &&
        cashNarrow.net === 30000 &&
        cashNarrow.transactionCount === 3,
      cashNarrow
    );

    check(
      'cash flow is never reported as net worth change',
      cashNarrow.net === 30000 &&
        summaryBefore.body.data?.current?.netWorth === 120000.5,
      { netCashFlow: cashNarrow.net, currentNetWorth: summaryBefore.body.data?.current?.netWorth }
    );

    console.log('\n7. negative net worth for user B and isolation');
    const bLiability = await call('/liabilities', {
      method: 'POST',
      token: userB.token,
      body: { name: 'E2E Student loan', type: 'PERSONAL_LOAN', outstandingAmount: '40000.00' },
    });
    check('creates a liability for user B', bLiability.status === 201, bLiability.body);

    const bSummary = await call('/wealth-analytics/summary', { token: userB.token });
    check(
      'user B gets a negative current net worth',
      bSummary.body.data?.current?.netWorth === -40000 &&
        bSummary.body.data?.current?.totalAssets === 0,
      bSummary.body.data?.current
    );
    check(
      'user B sees no goals',
      bSummary.body.data?.goals?.goalCount === 0 &&
        bSummary.body.data?.goals?.totalSavedAmount === 0,
      bSummary.body.data?.goals
    );

    const bAssets = await call('/wealth-analytics/assets', { token: userB.token });
    check(
      'user B sees no assets from user A',
      bAssets.body.data?.assetCount === 0 && (bAssets.body.data?.assets ?? []).length === 0,
      bAssets.body.data
    );

    const bHistory = await call('/wealth-analytics/net-worth', { token: userB.token });
    check(
      'user B sees no snapshots from user A',
      (bHistory.body.data?.history ?? []).length === 0,
      bHistory.body.data
    );

    const bCashFlow = await call('/wealth-analytics/cash-flow', { token: userB.token });
    check(
      'user B sees no transactions from user A',
      bCashFlow.body.data?.income === 0 &&
        bCashFlow.body.data?.transactionCount === 0,
      bCashFlow.body.data
    );

    const bLiabilities = await call('/wealth-analytics/liabilities', { token: userB.token });
    check(
      'user B liability composition only shows user B data',
      bLiabilities.body.data?.totalLiabilities === 40000 &&
        bLiabilities.body.data?.liabilityCount === 1,
      bLiabilities.body.data
    );

    console.log('\n8. analytics are read-only');
    const snapshotsBefore = await prisma.wealthSnapshot.count({
      where: { userId: userA.id },
    });
    const notificationsBefore = await prisma.notification.count({
      where: { userId: userA.id },
    });
    const transactionsBefore = await prisma.transaction.findMany({
      where: { userId: userA.id },
      orderBy: { id: 'asc' },
    });

    const endpoints = [
      '/wealth-analytics/summary',
      '/wealth-analytics/net-worth',
      '/wealth-analytics/assets',
      '/wealth-analytics/liabilities',
      '/wealth-analytics/cash-flow',
    ];
    for (const endpoint of endpoints) {
      await call(endpoint, { token: userA.token });
    }

    const snapshotsAfter = await prisma.wealthSnapshot.count({
      where: { userId: userA.id },
    });
    check('reading analytics creates no snapshot', snapshotsAfter === snapshotsBefore, {
      before: snapshotsBefore,
      after: snapshotsAfter,
    });
    const notificationsAfter = await prisma.notification.count({
      where: { userId: userA.id },
    });
    check('reading analytics creates no notification', notificationsAfter === notificationsBefore, {
      before: notificationsBefore,
      after: notificationsAfter,
    });
    const transactionsAfter = await prisma.transaction.findMany({
      where: { userId: userA.id },
      orderBy: { id: 'asc' },
    });
    check(
      'reading analytics never mutates a transaction',
      JSON.stringify(
        transactionsAfter.map((row) => ({
          id: row.id,
          amount: row.amount.toString(),
          updatedAt: row.updatedAt.toISOString(),
        }))
      ) ===
        JSON.stringify(
          transactionsBefore.map((row) => ({
            id: row.id,
            amount: row.amount.toString(),
            updatedAt: row.updatedAt.toISOString(),
          }))
        ),
      { before: transactionsBefore.length, after: transactionsAfter.length }
    );

    const assetAfter = await call('/assets', { token: userA.token });
    check(
      'reading analytics never mutates an asset',
      (assetAfter.body.data?.assets ?? []).some(
        (asset: Json) => asset.currentValue === 150000.5
      ) && (assetAfter.body.data?.assets ?? []).length === 2,
      assetAfter.body.data
    );

    const goalsAfter = await call('/goals', { token: userA.token });
    check(
      'reading analytics never mutates a goal',
      (goalsAfter.body.data?.goals ?? []).length === 2 &&
        (goalsAfter.body.data?.goals ?? []).every((goal: Json) => goal.contributionCount >= 0),
      goalsAfter.body.data
    );

    const storedSnapshot = await prisma.wealthSnapshot.findUnique({
      where: { id: backdatedSnapshot.id },
    });
    check(
      'reading analytics never rewrites a stored snapshot',
      storedSnapshot !== null &&
        Number(storedSnapshot.netWorth) === 80000 &&
        Number(storedSnapshot.totalAssets) === 100000,
      storedSnapshot
    );

    console.log('\n9. no write routes, no mass assignment, authentication required');
    for (const endpoint of endpoints) {
      const created = await call(endpoint, { method: 'POST', token: userA.token, body: {} });
      check(`POST ${endpoint} does not exist`, created.status === 404, created.status);
      const patched = await call(endpoint, { method: 'PATCH', token: userA.token, body: {} });
      check(`PATCH ${endpoint} does not exist`, patched.status === 404, patched.status);
      const deleted = await call(endpoint, { method: 'DELETE', token: userA.token });
      check(`DELETE ${endpoint} does not exist`, deleted.status === 404, deleted.status);
      const anonymous = await call(endpoint);
      check(`anonymous GET ${endpoint} is rejected`, anonymous.status === 401, anonymous.status);
    }

    const massAssigned = await call(
      '/wealth-analytics/summary?netWorth=999999&userId=someone-else',
      { token: userA.token }
    );
    check('rejects client supplied financial values', massAssigned.status === 400, massAssigned.body);

    const smuggledRange = await call(
      '/wealth-analytics/cash-flow?income=100000&expenses=1',
      { token: userA.token }
    );
    check('rejects cash flow values in the query', smuggledRange.status === 400, smuggledRange.body);

    const invalidDate = await call('/wealth-analytics/cash-flow?dateFrom=not-a-date', {
      token: userA.token,
    });
    check('rejects an invalid date', invalidDate.status === 400, invalidDate.body);
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
    console.log('E2E wealth analytics: PASS');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\nE2E wealth analytics: ERROR\n${String(error)}`);
    process.exit(1);
  });
