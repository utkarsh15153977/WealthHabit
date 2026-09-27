import { config } from 'dotenv';

config();

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
  const email = `e2e-al-${label}-${Date.now()}@example.com`;
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

async function main(): Promise<void> {
  console.log(`Assets & Liabilities E2E against ${BASE_URL}\n`);

  const userA = await registerUser('a');
  const userB = await registerUser('b');

  console.log('\n1. setup: a transaction and a savings goal to prove separation');
  const category = await call('/categories', {
    method: 'POST',
    token: userA.token,
    body: { name: 'E2E Groceries', type: 'EXPENSE' },
  });
  check('creates a category', category.status === 201, category.body);
  const categoryId = category.body.data?.category?.id;

  const transaction = await call('/transactions', {
    method: 'POST',
    token: userA.token,
    body: {
      categoryId,
      type: 'EXPENSE',
      amount: '1234.00',
      transactionDate: new Date().toISOString().slice(0, 10),
      description: 'E2E baseline transaction',
    },
  });
  check('creates a baseline transaction', transaction.status === 201, transaction.body);

  const goal = await call('/goals', {
    method: 'POST',
    token: userA.token,
    body: { name: 'E2E emergency fund', targetAmount: '200000.00', targetDate: '2027-01-01' },
  });
  check('creates a savings goal', goal.status === 201, goal.body);
  const goalId = goal.body.data?.goal?.id;

  const contribution = await call(`/goals/${goalId}/contributions`, {
    method: 'POST',
    token: userA.token,
    body: { amount: '20000.00' },
  });
  check('creates a goal contribution', contribution.status === 201, contribution.body);

  const progressBefore = await call(`/goals/${goalId}/progress`, { token: userA.token });
  check(
    'goal progress starts at 20000',
    progressBefore.body.data?.progress?.currentAmount === 20000,
    progressBefore.body
  );

  const transactionsBefore = await call('/transactions', { token: userA.token });
  const transactionCountBefore = transactionsBefore.body.data?.transactions?.length ?? 0;

  console.log('\n2. create assets');
  const cash = await call('/assets', {
    method: 'POST',
    token: userA.token,
    body: { name: 'E2E Cash wallet', currentValue: '0' },
  });
  check('creates a zero-valued asset', cash.status === 201, cash.body);
  check(
    'defaults type to OTHER and status to ACTIVE',
    cash.body.data?.asset?.type === 'OTHER' && cash.body.data?.asset?.status === 'ACTIVE',
    cash.body.data?.asset
  );
  check('never exposes userId', cash.body.data?.asset?.userId === undefined, cash.body.data?.asset);
  const cashId = cash.body.data?.asset?.id;

  const bank = await call('/assets', {
    method: 'POST',
    token: userA.token,
    body: {
      name: 'E2E Savings account',
      type: 'BANK_ACCOUNT',
      currentValue: '150000.50',
      notes: 'Primary account',
    },
  });
  check('creates a typed asset', bank.status === 201, bank.body);
  check(
    'stores the exact decimal value',
    bank.body.data?.asset?.currentValue === 150000.5,
    bank.body.data?.asset
  );
  const bankId = bank.body.data?.asset?.id;

  const negativeAsset = await call('/assets', {
    method: 'POST',
    token: userA.token,
    body: { name: 'E2E Bad asset', currentValue: '-10.00' },
  });
  check('rejects a negative asset value', negativeAsset.status === 400, negativeAsset.body);

  const massAssigned = await call('/assets', {
    method: 'POST',
    token: userA.token,
    body: { name: 'E2E Forged', currentValue: '1.00', userId: userB.id },
  });
  check('rejects mass assignment (userId)', massAssigned.status === 400, massAssigned.body);

  const myAssets = await call('/assets', { token: userA.token });
  check(
    'lists the two assets I own',
    myAssets.body.data?.total === 2 && myAssets.body.data?.assets?.length === 2,
    myAssets.body.data
  );

  console.log('\n3. create liabilities');
  const card = await call('/liabilities', {
    method: 'POST',
    token: userA.token,
    body: { name: 'E2E Credit card', type: 'CREDIT_CARD', outstandingAmount: '35000.00' },
  });
  check('creates a liability with ACTIVE status', card.status === 201, card.body);
  check(
    'status is ACTIVE while a balance remains',
    card.body.data?.liability?.status === 'ACTIVE',
    card.body.data?.liability
  );
  const cardId = card.body.data?.liability?.id;

  const negativeLiability = await call('/liabilities', {
    method: 'POST',
    token: userA.token,
    body: { name: 'E2E Bad liability', outstandingAmount: '-1' },
  });
  check(
    'rejects a negative outstanding amount',
    negativeLiability.status === 400,
    negativeLiability.body
  );

  console.log('\n4. summary totals');
  const summary = await call('/assets-liabilities/summary', { token: userA.token });
  check(
    'returns exact asset and liability totals',
    summary.body.data?.totalAssets === 150000.5 &&
      summary.body.data?.assetCount === 2 &&
      summary.body.data?.totalLiabilities === 35000 &&
      summary.body.data?.liabilityCount === 1,
    summary.body.data
  );
  const summaryKeys = Object.keys(summary.body.data ?? {}).sort().join(',');
  check(
    'exposes only the four documented fields (no net worth)',
    summaryKeys === 'assetCount,liabilityCount,totalAssets,totalLiabilities',
    summaryKeys
  );

  console.log('\n5. update balances');
  const updatedAsset = await call(`/assets/${bankId}`, {
    method: 'PATCH',
    token: userA.token,
    body: { currentValue: '175000.00' },
  });
  check(
    'updates only the asset value',
    updatedAsset.status === 200 &&
      updatedAsset.body.data?.asset?.currentValue === 175000 &&
      updatedAsset.body.data?.asset?.name === 'E2E Savings account',
    updatedAsset.body
  );

  const zeroed = await call(`/liabilities/${cardId}`, {
    method: 'PATCH',
    token: userA.token,
    body: { outstandingAmount: '0' },
  });
  check(
    'derives PAID_OFF once the balance reaches zero',
    zeroed.status === 200 && zeroed.body.data?.liability?.status === 'PAID_OFF',
    zeroed.body
  );

  const summaryAfter = await call('/assets-liabilities/summary', { token: userA.token });
  check(
    'summary reflects the updated balances',
    summaryAfter.body.data?.totalAssets === 175000 &&
      summaryAfter.body.data?.totalLiabilities === 0 &&
      summaryAfter.body.data?.liabilityCount === 1,
    summaryAfter.body.data
  );

  console.log('\n6. ownership isolation');
  const foreignGet = await call(`/assets/${bankId}`, { token: userB.token });
  check('another user cannot read my asset', foreignGet.status === 404, foreignGet.body);
  check(
    'foreign read returns ASSET_NOT_FOUND',
    foreignGet.body?.error?.code === 'ASSET_NOT_FOUND',
    foreignGet.body
  );

  const foreignPatch = await call(`/liabilities/${cardId}`, {
    method: 'PATCH',
    token: userB.token,
    body: { outstandingAmount: '1' },
  });
  check('another user cannot update my liability', foreignPatch.status === 404, foreignPatch.body);

  const foreignDelete = await call(`/assets/${bankId}`, {
    method: 'DELETE',
    token: userB.token,
  });
  check('another user cannot delete my asset', foreignDelete.status === 404, foreignDelete.body);
  const stillMine = await call(`/assets/${bankId}`, { token: userA.token });
  check('my asset still exists after the foreign delete', stillMine.status === 200, stillMine.body);

  console.log('\n7. transaction, budget and goal separation');
  const transactionsAfter = await call('/transactions', { token: userA.token });
  const transactionCountAfter = transactionsAfter.body.data?.transactions?.length ?? 0;
  check(
    'asset and liability mutations never create transactions',
    transactionCountAfter === transactionCountBefore,
    { transactionCountBefore, transactionCountAfter }
  );

  const progressAfter = await call(`/goals/${goalId}/progress`, { token: userA.token });
  check(
    'asset and liability mutations never change goal contributions',
    progressAfter.body.data?.progress?.currentAmount === 20000 &&
      progressAfter.body.data?.progress?.contributionCount === 1,
    progressAfter.body.data
  );

  const notifications = await call('/notifications', { token: userA.token });
  check(
    'no notifications were generated by the lifecycle',
    (notifications.body.data?.notifications ?? []).filter(
      (item: Json) => String(item.type ?? '').includes('ASSET')
    ).length === 0,
    notifications.body.data
  );

  console.log('\n8. cleanup and repeated deletes');
  const deleteAsset = await call(`/assets/${bankId}`, { method: 'DELETE', token: userA.token });
  check('deletes an asset', deleteAsset.status === 200, deleteAsset.body);
  const deleteCash = await call(`/assets/${cashId}`, { method: 'DELETE', token: userA.token });
  check('deletes the second asset', deleteCash.status === 200, deleteCash.body);
  const deleteLiability = await call(`/liabilities/${cardId}`, {
    method: 'DELETE',
    token: userA.token,
  });
  check('deletes a liability', deleteLiability.status === 200, deleteLiability.body);

  const repeatedDelete = await call(`/assets/${bankId}`, {
    method: 'DELETE',
    token: userA.token,
  });
  check('repeated delete returns 404', repeatedDelete.status === 404, repeatedDelete.body);

  const emptyAssets = await call('/assets', { token: userA.token });
  const emptyLiabilities = await call('/liabilities', { token: userA.token });
  check(
    'both lists are empty after cleanup',
    emptyAssets.body.data?.total === 0 && emptyLiabilities.body.data?.total === 0,
    { assets: emptyAssets.body.data, liabilities: emptyLiabilities.body.data }
  );

  const finalSummary = await call('/assets-liabilities/summary', { token: userA.token });
  check(
    'summary is zeroed after cleanup',
    finalSummary.body.data?.totalAssets === 0 &&
      finalSummary.body.data?.totalLiabilities === 0 &&
      finalSummary.body.data?.assetCount === 0 &&
      finalSummary.body.data?.liabilityCount === 0,
    finalSummary.body.data
  );

  const transactionsUntouched = await call('/transactions', { token: userA.token });
  check(
    'deleting assets and liabilities kept my transactions',
    (transactionsUntouched.body.data?.transactions ?? []).length === transactionCountBefore,
    transactionsUntouched.body.data
  );

  const goalUntouched = await call(`/goals/${goalId}/progress`, { token: userA.token });
  check(
    'deleting assets and liabilities kept my goal',
    goalUntouched.body.data?.progress?.currentAmount === 20000,
    goalUntouched.body.data
  );
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
      console.error(`Failures:\n - ${failures.join('\n - ')}`);
      process.exit(1);
    }
    console.log('E2E assets & liabilities: PASS');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\nE2E assets & liabilities: ERROR\n${String(error)}`);
    process.exit(1);
  });
