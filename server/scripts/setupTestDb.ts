import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';

config();

function deriveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) {
    return explicit;
  }

  const configured = process.env.DATABASE_URL;
  if (!configured) {
    throw new Error(
      'DATABASE_URL is not set. Copy server/.env.example to server/.env, or set TEST_DATABASE_URL.'
    );
  }

  const url = new URL(configured);
  const databaseName = url.pathname.replace(/^\//, '');

  if (!databaseName.endsWith('_test')) {
    url.pathname = `/${databaseName}_test`;
  }

  return url.toString();
}

const testDatabaseUrl = deriveTestDatabaseUrl();
const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');

console.log(`Test database: ${databaseName}`);

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: testDatabaseUrl },
});

process.exit(result.status ?? 1);
