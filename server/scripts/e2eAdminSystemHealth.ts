import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

config();

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5000/api';
const PASSWORD = 'E2ePassword123!';

type Json = Record<string, any>;

interface CallResult {
  status: number;
  body: Json;
}

interface E2eUser {
  token: string;
  id: string;
  email: string;
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
    headers?: Record<string, string>;
  } = {}
): Promise<CallResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers ?? {}),
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
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

async function registerUser(label: string): Promise<E2eUser> {
  const email = `e2e-adminhealth-${label}-${Date.now()}@example.com`;
  const response = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      firstName: 'E2E',
      lastName: label,
    }),
  });
  const payload = (await response.json()) as Json;
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(
      `register failed for ${label}: ${response.status} ${JSON.stringify(payload)}`
    );
  }
  const token = payload.data?.accessToken ?? payload.accessToken;
  const id = payload.data?.user?.id ?? payload.user?.id;
  if (!token) {
    throw new Error(`no access token for ${label}: ${JSON.stringify(payload)}`);
  }
  return { token, id, email };
}

const COMPONENT_STATUSES = ['HEALTHY', 'DEGRADED', 'UNHEALTHY'];

async function main(): Promise<void> {
  console.log(`Admin System Health E2E against ${BASE_URL}\n`);

  const admin = await registerUser('admin');
  const member = await registerUser('member');
  const createdUserIds = [admin.id, member.id].filter(
    (id): id is string => typeof id === 'string'
  );
  const prisma = new PrismaClient();

  try {
    console.log('\n1. create controlled ADMIN');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    console.log('Admin promoted');

    console.log('\n2. snapshot application data before health checks');
    const snapshot = {
      auditLogs: await prisma.auditLog.count(),
      transactions: await prisma.transaction.count(),
      notifications: await prisma.notification.count(),
      goals: await prisma.savingsGoal.count(),
      habits: await prisma.financialHabit.count(),
      assets: await prisma.asset.count(),
      liabilities: await prisma.liability.count(),
      snapshots: await prisma.wealthSnapshot.count(),
      challenges: await prisma.challenge.count(),
      users: await prisma.user.count(),
    };
    console.log('Snapshot taken');

    console.log('\n3. ADMIN reads system health');
    const health = await call('/admin/system-health', { token: admin.token });
    check('ADMIN GET -> 200', health.status === 200, health.body);
    check('success flag is true', health.body.success === true);
    const data = health.body.data ?? {};
    check(
      'response contains only the allowlisted sections',
      JSON.stringify(Object.keys(data).sort()) ===
        JSON.stringify(['application', 'database', 'generatedAt', 'runtime', 'status']),
      Object.keys(data)
    );
    check('overall status is known', COMPONENT_STATUSES.includes(data.status), data.status);
    check(
      'overall status is not UNHEALTHY while the database is reachable',
      data.status !== 'UNHEALTHY',
      data.status
    );

    console.log('\n4. application health');
    const app = data.application ?? {};
    check(
      'application section is allowlisted',
      JSON.stringify(Object.keys(app).sort()) ===
        JSON.stringify(['environment', 'service', 'status', 'uptimeSeconds']),
      Object.keys(app)
    );
    check('application status is HEALTHY', app.status === 'HEALTHY', app.status);
    check('service name is exposed', app.service === 'WealthHabit API', app.service);
    check(
      'environment is a safe category',
      ['development', 'test', 'production'].includes(app.environment),
      app.environment
    );
    check(
      'application uptime is numeric and non-negative',
      typeof app.uptimeSeconds === 'number' && app.uptimeSeconds >= 0,
      app.uptimeSeconds
    );

    console.log('\n5. database health');
    const db = data.database ?? {};
    check(
      'database section is allowlisted',
      JSON.stringify(Object.keys(db).sort()) ===
        JSON.stringify(['latencyMs', 'message', 'status']),
      Object.keys(db)
    );
    check('database status is HEALTHY', db.status === 'HEALTHY', db.status);
    check('database message is null when healthy', db.message === null, db.message);
    check(
      'health-query latency is numeric and non-negative',
      typeof db.latencyMs === 'number' &&
        Number.isFinite(db.latencyMs) &&
        db.latencyMs >= 0,
      db.latencyMs
    );

    console.log('\n6. runtime health');
    const runtime = data.runtime ?? {};
    check(
      'runtime section is allowlisted',
      JSON.stringify(Object.keys(runtime).sort()) ===
        JSON.stringify(['memory', 'nodeVersion', 'status', 'uptimeSeconds']),
      Object.keys(runtime)
    );
    check(
      'runtime status is known',
      COMPONENT_STATUSES.includes(runtime.status),
      runtime.status
    );
    check(
      'node version is major.minor',
      typeof runtime.nodeVersion === 'string' && /^\d+\.\d+$/.test(runtime.nodeVersion),
      runtime.nodeVersion
    );
    check(
      'runtime uptime is numeric and non-negative',
      typeof runtime.uptimeSeconds === 'number' && runtime.uptimeSeconds >= 0,
      runtime.uptimeSeconds
    );
    const memory = runtime.memory ?? {};
    check(
      'memory section is allowlisted',
      JSON.stringify(Object.keys(memory).sort()) ===
        JSON.stringify(['heapTotalMb', 'heapUsedMb', 'rssMb']),
      Object.keys(memory)
    );
    check(
      'memory values are positive numbers',
      ['rssMb', 'heapUsedMb', 'heapTotalMb'].every(
        (key) => typeof memory[key] === 'number' && memory[key] > 0
      ),
      memory
    );
    check(
      'heap used never exceeds heap total',
      typeof memory.heapUsedMb === 'number' &&
        typeof memory.heapTotalMb === 'number' &&
        memory.heapUsedMb <= memory.heapTotalMb + 1,
      memory
    );

    console.log('\n7. generatedAt timestamp');
    const generatedAt = Date.parse(data.generatedAt);
    check('generatedAt is parseable', !Number.isNaN(generatedAt), data.generatedAt);
    check(
      'generatedAt is fresh (within 60s)',
      !Number.isNaN(generatedAt) && Math.abs(Date.now() - generatedAt) < 60_000,
      data.generatedAt
    );

    console.log('\n8. sensitive data is never exposed');
    const raw = JSON.stringify(health.body);
    const forbiddenValues = [
      process.env.DATABASE_URL,
      process.env.JWT_ACCESS_SECRET,
      'dev-secret-change-in-production',
      admin.token,
      member.token,
      PASSWORD,
    ].filter((value): value is string => Boolean(value));
    for (const value of forbiddenValues) {
      check(
        `value absent: ${value === admin.token ? 'admin token' : value === member.token ? 'member token' : value === PASSWORD ? 'E2E password' : value.slice(0, 30)}`,
        !raw.includes(value)
      );
    }
    const forbiddenKeys = [
      'DATABASE_URL',
      'JWT_SECRET',
      'JWT_ACCESS_SECRET',
      'accessToken',
      'refreshToken',
      'passwordHash',
      'refreshTokenHash',
      'process.env',
      'wh_refresh_token',
      '"pid"',
      '"argv"',
      '"env"',
      '"execPath"',
    ];
    for (const key of forbiddenKeys) {
      check(`field absent: ${key}`, !raw.includes(key));
    }
    check('no filesystem path from the server', !raw.includes(process.cwd()));
    check('no node_modules path', !raw.includes('node_modules'));
    check('no stack frames', !raw.includes('\\n    at '));
    check('no raw Error text', !raw.includes('Error:'));

    console.log('\n9. anonymous access -> 401');
    check('anonymous GET -> 401', (await call('/admin/system-health')).status === 401);

    console.log('\n10. normal USER access -> 403');
    const memberAccess = await call('/admin/system-health', { token: member.token });
    check('USER GET -> 403', memberAccess.status === 403, memberAccess.body);

    console.log('\n11. spoofed headers and query cannot bypass RBAC');
    const spoofedRole = await fetch(`${BASE_URL}/admin/system-health`, {
      headers: {
        Authorization: `Bearer ${member.token}`,
        'X-User-Role': 'ADMIN',
        'Content-Type': 'application/json',
      },
    });
    check('USER with X-User-Role: ADMIN -> 403', spoofedRole.status === 403);
    const spoofedId = await fetch(`${BASE_URL}/admin/system-health`, {
      headers: {
        Authorization: `Bearer ${member.token}`,
        'X-User-Id': admin.id,
        'Content-Type': 'application/json',
      },
    });
    check('USER with X-User-Id: admin -> 403', spoofedId.status === 403);
    const spoofedQuery = await call('/admin/system-health?role=ADMIN', {
      token: member.token,
    });
    check('USER with ?role=ADMIN -> 403', spoofedQuery.status === 403);

    console.log('\n12. health reads have no application side effects');
    const repeatOne = await call('/admin/system-health', { token: admin.token });
    const repeatTwo = await call('/admin/system-health', { token: admin.token });
    const repeatThree = await call('/admin/system-health', { token: admin.token });
    check('repeated reads stay 200',
      [repeatOne, repeatTwo, repeatThree].every((r) => r.status === 200));
    check('repeated reads keep the same shape',
      [repeatOne, repeatTwo, repeatThree].every(
        (r) =>
          JSON.stringify(Object.keys(r.body.data ?? {}).sort()) ===
          JSON.stringify(['application', 'database', 'generatedAt', 'runtime', 'status'])
      ));

    const after = {
      auditLogs: await prisma.auditLog.count(),
      transactions: await prisma.transaction.count(),
      notifications: await prisma.notification.count(),
      goals: await prisma.savingsGoal.count(),
      habits: await prisma.financialHabit.count(),
      assets: await prisma.asset.count(),
      liabilities: await prisma.liability.count(),
      snapshots: await prisma.wealthSnapshot.count(),
      challenges: await prisma.challenge.count(),
      users: await prisma.user.count(),
    };
    for (const key of Object.keys(snapshot) as (keyof typeof snapshot)[]) {
      check(`${key} count unchanged`, snapshot[key] === after[key], {
        before: snapshot[key],
        after: after[key],
      });
    }
    check('no audit rows were generated by health reads', after.auditLogs === snapshot.auditLogs);

    console.log('\n13. only GET is available (no mutation methods)');
    const post = await fetch(`${BASE_URL}/admin/system-health`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${admin.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'HEALTHY' }),
    });
    check('POST /system-health -> 404', post.status === 404, post.status);
    const patch = await fetch(`${BASE_URL}/admin/system-health`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${admin.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'HEALTHY' }),
    });
    check('PATCH /system-health -> 404', patch.status === 404, patch.status);
    const del = await fetch(`${BASE_URL}/admin/system-health`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    check('DELETE /system-health -> 404', del.status === 404, del.status);
    const postAfter = await prisma.auditLog.count();
    check('method attempts wrote no audit rows', postAfter === snapshot.auditLogs);
  } finally {
    try {
      await prisma.auditLog.deleteMany({
        where: { actorUserId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      console.log('\n14. cleanup: removed throwaway users (no health data persisted)');
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
    console.log('E2E admin system health: PASS');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\nE2E admin system health: ERROR\n${String(error)}`);
    process.exit(1);
  });
