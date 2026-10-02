import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { resolveTestDatabaseUrl } from './lib/dbSafety.js';

config();

process.env.NODE_ENV = 'test';

const testDatabaseUrl = resolveTestDatabaseUrl(process.env, {
  onSkipConfigured: (target) =>
    console.warn(
      `[db-safety] Ignoring DATABASE_URL target "${target}"; the test database is local.`
    ),
});
const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');

console.log(`Test database: ${databaseName}`);

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: testDatabaseUrl },
});

process.exit(result.status ?? 1);
