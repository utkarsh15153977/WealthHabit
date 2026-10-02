import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolveTestDatabaseUrl } from './scripts/lib/dbSafety.js';

config();

const testDatabaseUrl = resolveTestDatabaseUrl(process.env, {
  onSkipConfigured: (target) =>
    console.warn(
      `[db-safety] Ignoring DATABASE_URL target "${target}"; tests use the safe local test database.`
    ),
});

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
    },
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    fileParallelism: false,
  },
});
