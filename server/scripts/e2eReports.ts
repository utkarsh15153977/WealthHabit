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

interface RawResult {
  status: number;
  headers: Headers;
  text: string;
  bytes: Buffer;
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

async function callRaw(
  path: string,
  token?: string
): Promise<RawResult> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: authHeaders(token),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, text: buffer.toString('utf8'), bytes: buffer };
}

async function registerUser(label: string): Promise<{ token: string; id: string }> {
  const email = `e2e-report-${label}-${Date.now()}@example.com`;
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

const REPORT_ENDPOINTS = [
  '/reports/financial',
  '/reports/financial.csv',
  '/reports/financial.pdf',
];

async function main(): Promise<void> {
  console.log(`Financial Report E2E against ${BASE_URL}\n`);

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
      body: { name: 'E2E Report Salary', type: 'INCOME' },
    });
    check('creates an income category', incomeCategory.status === 201, incomeCategory.body);
    const incomeCategoryId = incomeCategory.body.data?.category?.id as string;

    const foodCategory = await call('/categories', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Report Food', type: 'EXPENSE' },
    });
    const foodCategoryId = foodCategory.body.data?.category?.id as string;

    const rentCategory = await call('/categories', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Report Rent', type: 'EXPENSE' },
    });
    const rentCategoryId = rentCategory.body.data?.category?.id as string;

    for (const seed of [
      { categoryId: incomeCategoryId, type: 'INCOME', amount: '100000.00', transactionDate: dayOnly(10) },
      { categoryId: incomeCategoryId, type: 'INCOME', amount: '50000.00', transactionDate: dayOnly(200) },
      { categoryId: foodCategoryId, type: 'EXPENSE', amount: '40000.00', transactionDate: dayOnly(5) },
      { categoryId: rentCategoryId, type: 'EXPENSE', amount: '30000.00', transactionDate: dayOnly(3) },
    ]) {
      const created = await call('/transactions', {
        method: 'POST',
        token: userA.token,
        body: seed,
      });
      check(`creates a ${seed.type.toLowerCase()} transaction`, created.status === 201, created.body);
    }

    for (const asset of [
      { name: 'E2E Cash wallet', type: 'CASH', currentValue: '5000.00' },
      { name: 'E2E Savings account', type: 'BANK_ACCOUNT', currentValue: '150000.50' },
      { name: '=SUM(A1:A9)', type: 'CASH', currentValue: '1000.00' },
    ]) {
      const created = await call('/assets', {
        method: 'POST',
        token: userA.token,
        body: asset,
      });
      check(`creates the asset ${asset.name}`, created.status === 201, created.body);
    }

    const liability = await call('/liabilities', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Credit card', type: 'CREDIT_CARD', outstandingAmount: '35000.00' },
    });
    check('creates a liability', liability.status === 201, liability.body);

    const activeGoal = await call('/goals', {
      method: 'POST',
      token: userA.token,
      body: { name: 'E2E Emergency fund', targetAmount: '200000.00', targetDate: '2027-01-01' },
    });
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
    const completedGoalId = completedGoal.body.data?.goal?.id as string;
    const completedContribution = await call(`/goals/${completedGoalId}/contributions`, {
      method: 'POST',
      token: userA.token,
      body: { amount: '10000.00' },
    });
    check('contributes to the second goal', completedContribution.status === 201, completedContribution.body);

    const capture = await call('/wealth-snapshots', {
      method: 'POST',
      token: userA.token,
      body: {},
    });
    check('captures a wealth snapshot', capture.status === 201 || capture.status === 200, capture.body);

    const backdatedSnapshot = await prisma.wealthSnapshot.create({
      data: {
        userId: userA.id,
        snapshotDate: new Date(utcDaysAgo(30)),
        totalAssets: 100000,
        totalLiabilities: 20000,
        netWorth: 80000,
      },
    });

    console.log('\n2. JSON report contract');
    const json = await call('/reports/financial', { token: userA.token });
    check('JSON report responds 200', json.status === 200, json.body);
    const data = json.body.data ?? {};
    check(
      'exposes the UTC period',
      data.period?.timezone === 'UTC' &&
        typeof data.period?.dateFrom === 'string' &&
        typeof data.period?.dateTo === 'string',
      data.period
    );
    check(
      'reports the same cash flow as the analytics service',
      data.overview?.income === 150000 &&
        data.overview?.expenses === 70000 &&
        data.overview?.netCashFlow === 80000 &&
        data.overview?.transactionCount === 4,
      data.overview
    );
    check(
      'reports the same current position as the analytics service',
      data.overview?.totalAssets === 156000.5 &&
        data.overview?.totalLiabilities === 35000 &&
        data.overview?.netWorth === 121000.5,
      data.overview
    );
    check(
      'reports the same goal totals as the analytics service',
      data.overview?.activeGoalCount === 1 &&
        data.overview?.completedGoalCount === 1 &&
        data.overview?.totalGoalTarget === 210000 &&
        data.overview?.totalGoalSaved === 60000 &&
        data.overview?.goalProgressPercent === 28.57,
      data.overview
    );
    check(
      'lists income and expense categories with shares',
      data.incomeCategories?.length === 1 &&
        data.incomeCategories[0]?.name === 'E2E Report Salary' &&
        data.incomeCategories[0]?.percentage === 100 &&
        data.expenseCategories?.length === 2 &&
        data.expenseCategories[0]?.name === 'E2E Report Food' &&
        data.expenseCategories[0]?.percentage === 57.14,
      { income: data.incomeCategories, expenses: data.expenseCategories }
    );
    check(
      'lists assets, liabilities, snapshots and goals',
      data.assets?.assetCount === 3 &&
        data.assets?.totalAssets === 156000.5 &&
        data.liabilities?.liabilityCount === 1 &&
        data.liabilities?.totalLiabilities === 35000 &&
        data.netWorthHistory?.length === 2 &&
        data.goals?.goalCount === 2,
      {
        assets: data.assets?.assetCount,
        liabilities: data.liabilities?.liabilityCount,
        snapshots: data.netWorthHistory?.length,
        goals: data.goals?.goalCount,
      }
    );

    const analyticsSummary = await call('/wealth-analytics/summary', { token: userA.token });
    const analyticsCashFlow = await call('/wealth-analytics/cash-flow', { token: userA.token });
    check(
      'JSON report agrees with the existing analytics endpoints',
      data.overview?.totalAssets === analyticsSummary.body.data?.current?.totalAssets &&
        data.overview?.netWorth === analyticsSummary.body.data?.current?.netWorth &&
        data.overview?.income === analyticsCashFlow.body.data?.income &&
        data.overview?.expenses === analyticsCashFlow.body.data?.expenses &&
        data.overview?.goalProgressPercent === analyticsSummary.body.data?.goals?.progressPercent,
      { report: data.overview, analytics: analyticsSummary.body.data }
    );

    console.log('\n3. CSV export');
    const csv = await callRaw('/reports/financial.csv', userA.token);
    check('CSV responds 200', csv.status === 200, csv.status);
    check(
      'CSV is served as text/csv with an attachment filename',
      (csv.headers.get('content-type') ?? '').startsWith('text/csv') &&
        /attachment; filename="wealthhabit-financial-report-\d{4}-\d{2}-\d{2}\.csv"/.test(
          csv.headers.get('content-disposition') ?? ''
        ),
      {
        type: csv.headers.get('content-type'),
        disposition: csv.headers.get('content-disposition'),
      }
    );
    check('CSV is never cacheable', csv.headers.get('cache-control') === 'no-store');
    check(
      'CSV starts with a UTF-8 BOM',
      csv.bytes[0] === 0xef && csv.bytes[1] === 0xbb && csv.bytes[2] === 0xbf,
      csv.bytes.slice(0, 3)
    );
    check('CSV uses CRLF line endings', csv.text.includes('\r\n') && !/[^\r]\n/.test(csv.text));
    for (const section of [
      'WealthHabit Financial Report',
      'Financial Overview',
      'Income Categories',
      'Expense Categories',
      'Current Asset Position',
      'Current Liability Position',
      'Net Worth',
      'Savings Goals',
    ]) {
      check(`CSV contains the ${section} section`, csv.text.includes(section));
    }
    for (const row of [
      'Total income,150000.00',
      'Total expenses,70000.00',
      'Net cash flow,80000.00',
      'Total assets,156000.50',
      'Total liabilities,35000.00',
      'Current net worth,121000.50',
      'Total goal target,210000.00',
      'Total goal saved,60000.00',
      'E2E Report Salary,150000.00,100.00',
      'E2E Report Food,40000.00,57.14',
    ]) {
      check(`CSV contains the row ${row}`, csv.text.includes(row), csv.text);
    }
    check(
      'CSV neutralises a spreadsheet formula in an asset name',
      csv.text.includes("'=SUM(A1:A9)") && !/(^|,)=SUM/m.test(csv.text)
    );

    console.log('\n4. PDF export');
    const pdf = await callRaw('/reports/financial.pdf', userA.token);
    check('PDF responds 200', pdf.status === 200, pdf.status);
    check(
      'PDF is served as application/pdf with an attachment filename',
      pdf.headers.get('content-type') === 'application/pdf' &&
        /attachment; filename="wealthhabit-financial-report-\d{4}-\d{2}-\d{2}\.pdf"/.test(
          pdf.headers.get('content-disposition') ?? ''
        ),
      {
        type: pdf.headers.get('content-type'),
        disposition: pdf.headers.get('content-disposition'),
      }
    );
    check('PDF is never cacheable', pdf.headers.get('cache-control') === 'no-store');
    check(
      'PDF carries the declared content length',
      Number(pdf.headers.get('content-length')) === pdf.bytes.length,
      { header: pdf.headers.get('content-length'), actual: pdf.bytes.length }
    );
    const header = pdf.bytes.subarray(0, 5).toString('latin1');
    const trailer = pdf.bytes.subarray(-1024).toString('latin1');
    check('PDF has a valid header', header === '%PDF-', header);
    check('PDF has an EOF marker', trailer.includes('%%EOF'));

    console.log('\n5. the three formats are the same report');
    const narrowRange = `?dateFrom=${encodeURIComponent(utcDaysAgo(90))}`;
    const narrowJson = await call(`/reports/financial${narrowRange}`, { token: userA.token });
    const narrowCsv = await callRaw(`/reports/financial.csv${narrowRange}`, userA.token);
    check(
      'the JSON honours the selected range',
      narrowJson.body.data?.overview?.income === 100000 &&
        narrowJson.body.data?.overview?.transactionCount === 3,
      narrowJson.body.data?.overview
    );
    check(
      'the CSV honours the same selected range',
      narrowCsv.text.includes('Total income,100000.00') &&
        !narrowCsv.text.includes('Total income,150000.00'),
      narrowCsv.text
    );
    check(
      'the default report keeps the wider range',
      data.overview?.income === 150000
    );

    console.log('\n6. reports are read-only');
    const countsBefore = {
      assets: await prisma.asset.count({ where: { userId: userA.id } }),
      liabilities: await prisma.liability.count({ where: { userId: userA.id } }),
      transactions: await prisma.transaction.count({ where: { userId: userA.id } }),
      snapshots: await prisma.wealthSnapshot.count({ where: { userId: userA.id } }),
      goals: await prisma.savingsGoal.count({ where: { userId: userA.id } }),
      notifications: await prisma.notification.count({ where: { userId: userA.id } }),
    };

    for (const endpoint of REPORT_ENDPOINTS) {
      await call(endpoint, { token: userA.token });
      await callRaw(endpoint, userA.token);
    }

    const countsAfter = {
      assets: await prisma.asset.count({ where: { userId: userA.id } }),
      liabilities: await prisma.liability.count({ where: { userId: userA.id } }),
      transactions: await prisma.transaction.count({ where: { userId: userA.id } }),
      snapshots: await prisma.wealthSnapshot.count({ where: { userId: userA.id } }),
      goals: await prisma.savingsGoal.count({ where: { userId: userA.id } }),
      notifications: await prisma.notification.count({ where: { userId: userA.id } }),
    };
    check('reading reports creates or changes no record', JSON.stringify(countsBefore) === JSON.stringify(countsAfter), {
      before: countsBefore,
      after: countsAfter,
    });

    const storedSnapshot = await prisma.wealthSnapshot.findUnique({
      where: { id: backdatedSnapshot.id },
    });
    check(
      'reading reports never rewrites a stored snapshot',
      storedSnapshot !== null && Number(storedSnapshot.netWorth) === 80000,
      storedSnapshot
    );

    console.log('\n7. no write routes, no mass assignment, authentication required');
    for (const endpoint of REPORT_ENDPOINTS) {
      const created = await call(endpoint, { method: 'POST', token: userA.token, body: {} });
      check(`POST ${endpoint} does not exist`, created.status === 404, created.status);
      const patched = await call(endpoint, { method: 'PATCH', token: userA.token, body: {} });
      check(`PATCH ${endpoint} does not exist`, patched.status === 404, patched.status);
      const deleted = await call(endpoint, { method: 'DELETE', token: userA.token });
      check(`DELETE ${endpoint} does not exist`, deleted.status === 404, deleted.status);
      const anonymous = await callRaw(endpoint);
      check(`anonymous GET ${endpoint} is rejected`, anonymous.status === 401, anonymous.status);
    }

    const massAssigned = await call(
      '/reports/financial?userId=someone-else&netWorth=999999',
      { token: userA.token }
    );
    check('rejects client supplied ownership or financial values', massAssigned.status === 400, massAssigned.body);

    const reversed = await call(
      `/reports/financial?dateFrom=${encodeURIComponent(utcDaysAgo(1))}&dateTo=${encodeURIComponent(utcDaysAgo(30))}`,
      { token: userA.token }
    );
    check('rejects a reversed date range', reversed.status === 400, reversed.body);

    const tooWide = await call(
      `/reports/financial?dateFrom=${encodeURIComponent(utcDaysAgo(3000))}`,
      { token: userA.token }
    );
    check('rejects an unbounded date range', tooWide.status === 400, tooWide.body);

    console.log('\n8. user isolation');
    const bJson = await call('/reports/financial', { token: userB.token });
    check(
      'user B gets an empty report',
      bJson.body.data?.overview?.income === 0 &&
        bJson.body.data?.overview?.transactionCount === 0 &&
        bJson.body.data?.overview?.totalAssets === 0 &&
        bJson.body.data?.overview?.netWorth === 0,
      bJson.body.data?.overview
    );
    const bCsv = await callRaw('/reports/financial.csv', userB.token);
    check(
      'user B CSV contains none of user A figures',
      bCsv.text.includes('Total income,0.00') &&
        bCsv.text.includes('Total assets,0.00') &&
        !bCsv.text.includes('E2E Report Salary') &&
        !bCsv.text.includes('E2E Savings account')
    );
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
    console.log('E2E reports: PASS');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\nE2E reports: ERROR\n${String(error)}`);
    process.exit(1);
  });
