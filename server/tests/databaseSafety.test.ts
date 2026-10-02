import { describe, expect, it } from 'vitest';
import {
  SAFE_LOCAL_TEST_DATABASE_URL,
  UnsafeDatabaseError,
  assertSafeE2EDatabaseUrl,
  assertSafeTestDatabaseUrl,
  resolveTestDatabaseUrl,
} from '../scripts/lib/dbSafety.js';

const LOCAL_TEST_URL = 'postgresql://wealthhabit:wealthhabit@localhost:5433/wealthhabit_test';
const LOCAL_DEV_URL = 'postgresql://wealthhabit:wealthhabit@localhost:5433/wealthhabit';
const REMOTE_RDS_TEST_URL =
  'postgresql://user:pass@db.abc123.ap-south-1.rds.amazonaws.com:5432/wealthhabit_test';
const REMOTE_RDS_PROD_URL =
  'postgresql://user:pass@db.abc123.ap-south-1.rds.amazonaws.com:5432/wealthhabit';
const REMOTE_STAGING_URL =
  'postgresql://user:pass@staging-db.internal.example.com:5432/wealthhabit_staging';
const REMOTE_INTERNAL_TEST_URL =
  'postgresql://user:pass@db.internal.example.com:5432/wealthhabit_test';

function expectRefusal(run: () => unknown, ...fragments: string[]): UnsafeDatabaseError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(UnsafeDatabaseError);
  const error = caught as UnsafeDatabaseError;
  for (const fragment of fragments) {
    expect(error.message).toContain(fragment);
  }
  return error;
}

describe('assertSafeTestDatabaseUrl (automated tests)', () => {
  it('accepts a local *_test database with NODE_ENV=test', () => {
    expect(assertSafeTestDatabaseUrl(LOCAL_TEST_URL, { NODE_ENV: 'test' })).toBe(LOCAL_TEST_URL);
  });

  it('rejects NODE_ENV other than test', () => {
    expectRefusal(
      () => assertSafeTestDatabaseUrl(LOCAL_TEST_URL, { NODE_ENV: 'development' }),
      'NODE_ENV is "development"',
      'require NODE_ENV=test'
    );
  });

  it('rejects a missing NODE_ENV', () => {
    expectRefusal(
      () => assertSafeTestDatabaseUrl(LOCAL_TEST_URL, {}),
      'NODE_ENV is "unset"',
      'require NODE_ENV=test'
    );
  });

  it('rejects the production database name', () => {
    expectRefusal(
      () => assertSafeTestDatabaseUrl(LOCAL_DEV_URL, { NODE_ENV: 'test' }),
      '"wealthhabit" is the production database name'
    );
  });

  it('rejects a local database name that does not end with _test', () => {
    expectRefusal(
      () =>
        assertSafeTestDatabaseUrl('postgresql://u:p@localhost:5433/wealthhabit_dev', {
          NODE_ENV: 'test',
        }),
      'must end with "_test"'
    );
  });

  it('rejects a remote host by default', () => {
    expectRefusal(
      () => assertSafeTestDatabaseUrl(REMOTE_INTERNAL_TEST_URL, { NODE_ENV: 'test' }),
      'not a local test host',
      'ALLOW_REMOTE_TEST_DB=1'
    );
  });

  it('rejects an AWS host even with ALLOW_REMOTE_TEST_DB=1', () => {
    expectRefusal(
      () =>
        assertSafeTestDatabaseUrl(REMOTE_RDS_TEST_URL, {
          NODE_ENV: 'test',
          ALLOW_REMOTE_TEST_DB: '1',
        }),
      'AWS endpoint',
      'cannot be overridden'
    );
  });

  it('accepts a non-AWS remote *_test host with ALLOW_REMOTE_TEST_DB=1', () => {
    expect(
      assertSafeTestDatabaseUrl(REMOTE_INTERNAL_TEST_URL, {
        NODE_ENV: 'test',
        ALLOW_REMOTE_TEST_DB: '1',
      })
    ).toBe(REMOTE_INTERNAL_TEST_URL);
  });

  it('rejects a missing database URL', () => {
    expectRefusal(
      () => assertSafeTestDatabaseUrl(undefined, { NODE_ENV: 'test' }),
      'No database URL was provided'
    );
  });

  it('rejects a non-postgres protocol', () => {
    expectRefusal(
      () => assertSafeTestDatabaseUrl('mysql://localhost:3306/wealthhabit_test', { NODE_ENV: 'test' }),
      'is not postgres'
    );
  });

  it('rejects a URL without a database name', () => {
    expectRefusal(
      () => assertSafeTestDatabaseUrl('postgresql://u:p@localhost:5433/', { NODE_ENV: 'test' }),
      'does not contain a database name'
    );
  });

  it('never prints credentials in error messages', () => {
    const error = expectRefusal(
      () => assertSafeTestDatabaseUrl(REMOTE_INTERNAL_TEST_URL, { NODE_ENV: 'test' }),
      'db.internal.example.com/wealthhabit_test'
    );
    expect(error.message).not.toContain('pass');
    expect(error.message).not.toContain('user');
  });
});

describe('assertSafeE2EDatabaseUrl (e2e scripts)', () => {
  it('accepts a local *_test database without opt-in', () => {
    expect(assertSafeE2EDatabaseUrl(LOCAL_TEST_URL, { NODE_ENV: 'development' })).toBe(
      LOCAL_TEST_URL
    );
  });

  it('rejects a local non-_test database without E2E_ALLOW_DB=1', () => {
    expectRefusal(
      () => assertSafeE2EDatabaseUrl(LOCAL_DEV_URL, { NODE_ENV: 'development' }),
      'E2E_ALLOW_DB=1 is not set',
      'local *_test database'
    );
  });

  it('accepts a local non-_test database with E2E_ALLOW_DB=1', () => {
    expect(
      assertSafeE2EDatabaseUrl(LOCAL_DEV_URL, { NODE_ENV: 'development', E2E_ALLOW_DB: '1' })
    ).toBe(LOCAL_DEV_URL);
  });

  it('rejects a remote database without E2E_ALLOW_DB=1', () => {
    expectRefusal(
      () => assertSafeE2EDatabaseUrl(REMOTE_STAGING_URL, { NODE_ENV: 'development' }),
      'does not satisfy the local test rules',
      'E2E_ALLOW_DB=1 is not set'
    );
  });

  it('accepts a remote non-production database with E2E_ALLOW_DB=1', () => {
    expect(
      assertSafeE2EDatabaseUrl(REMOTE_STAGING_URL, {
        NODE_ENV: 'development',
        E2E_ALLOW_DB: '1',
      })
    ).toBe(REMOTE_STAGING_URL);
  });

  it('rejects the production database name on a remote host even with E2E_ALLOW_DB=1', () => {
    expectRefusal(
      () =>
        assertSafeE2EDatabaseUrl(REMOTE_RDS_PROD_URL, {
          NODE_ENV: 'development',
          E2E_ALLOW_DB: '1',
        }),
      '"wealthhabit" is the production database name',
      'does not authorize the production database'
    );
  });

  it('rejects NODE_ENV=production even for a local *_test database', () => {
    expectRefusal(
      () => assertSafeE2EDatabaseUrl(LOCAL_TEST_URL, { NODE_ENV: 'production' }),
      'NODE_ENV=production is never allowed'
    );
  });

  it('rejects a missing database URL', () => {
    expectRefusal(
      () => assertSafeE2EDatabaseUrl(undefined, { NODE_ENV: 'development' }),
      'No database URL was provided'
    );
  });

  it('never prints credentials in error messages', () => {
    const error = expectRefusal(
      () => assertSafeE2EDatabaseUrl(REMOTE_RDS_PROD_URL, { NODE_ENV: 'development' }),
      'E2E_ALLOW_DB=1'
    );
    expect(error.message).not.toContain('pass');
    expect(error.message).not.toContain('user');
  });
});

describe('resolveTestDatabaseUrl', () => {
  it('prefers TEST_DATABASE_URL over DATABASE_URL', () => {
    expect(
      resolveTestDatabaseUrl({
        NODE_ENV: 'test',
        TEST_DATABASE_URL: LOCAL_TEST_URL,
        DATABASE_URL: REMOTE_RDS_PROD_URL,
      })
    ).toBe(LOCAL_TEST_URL);
  });

  it('never derives from a remote DATABASE_URL and reports the skipped target', () => {
    const skipped: string[] = [];
    const resolved = resolveTestDatabaseUrl(
      { NODE_ENV: 'test', DATABASE_URL: REMOTE_RDS_PROD_URL },
      { onSkipConfigured: (target) => skipped.push(target) }
    );

    expect(resolved).toBe(SAFE_LOCAL_TEST_DATABASE_URL);
    expect(resolved).toContain('localhost');
    expect(skipped).toEqual(['db.abc123.ap-south-1.rds.amazonaws.com/wealthhabit']);
    expect(skipped[0]).not.toContain('pass');
  });

  it('derives *_test from a local DATABASE_URL', () => {
    expect(
      resolveTestDatabaseUrl({ NODE_ENV: 'test', DATABASE_URL: LOCAL_DEV_URL })
    ).toBe('postgresql://wealthhabit:wealthhabit@localhost:5433/wealthhabit_test');
  });

  it('falls back to the safe local default when nothing is configured', () => {
    expect(resolveTestDatabaseUrl({ NODE_ENV: 'test' })).toBe(SAFE_LOCAL_TEST_DATABASE_URL);
  });

  it('rejects an unparseable DATABASE_URL instead of guessing', () => {
    expectRefusal(
      () => resolveTestDatabaseUrl({ NODE_ENV: 'test', DATABASE_URL: 'not a url' }),
      'not a parseable URL'
    );
  });

  it('rejects an unsafe explicit TEST_DATABASE_URL', () => {
    expectRefusal(
      () => resolveTestDatabaseUrl({ NODE_ENV: 'test', TEST_DATABASE_URL: REMOTE_RDS_TEST_URL }),
      'AWS endpoint'
    );
  });

  it('rejects resolution when NODE_ENV is not test', () => {
    expectRefusal(
      () => resolveTestDatabaseUrl({ TEST_DATABASE_URL: LOCAL_TEST_URL }),
      'require NODE_ENV=test'
    );
  });
});
