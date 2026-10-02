export type EnvLike = Record<string, string | undefined>;

export class UnsafeDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeDatabaseError';
  }
}

export const SAFE_LOCAL_TEST_DATABASE_URL =
  'postgresql://wealthhabit:wealthhabit@localhost:5433/wealthhabit_test';

export const PRODUCTION_DATABASE_NAMES = new Set(['wealthhabit']);

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

const AWS_HOST_SUFFIXES = ['.amazonaws.com', '.amazonaws.com.cn'];

export interface ResolveOptions {
  onSkipConfigured?: (sanitizedTarget: string) => void;
}

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[/, '').replace(/\]$/, '');
}

function databaseNameOf(url: URL): string {
  return url.pathname.replace(/^\//, '');
}

function describeTarget(url: URL): string {
  const hostname = hostnameOf(url) || '<missing-host>';
  const databaseName = databaseNameOf(url);
  return databaseName ? `${hostname}/${databaseName}` : `${hostname}/<missing-database-name>`;
}

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

function isAwsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return AWS_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function ensurePostgresUrl(
  raw: string | undefined,
  missingFix: string
): { target: string; url: URL } {
  const value = raw?.trim();

  if (!value) {
    throw new UnsafeDatabaseError(`[db-safety] No database URL was provided. ${missingFix}`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeDatabaseError(
      '[db-safety] The database URL is not a parseable URL. ' +
        'Expected a connection string such as postgresql://user:password@localhost:5433/wealthhabit_test.'
    );
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeDatabaseError(
      `[db-safety] Refused database target "${describeTarget(url)}": protocol "${url.protocol}" ` +
        'is not postgres. Only postgres:// and postgresql:// URLs are allowed.'
    );
  }

  if (!url.hostname) {
    throw new UnsafeDatabaseError(
      `[db-safety] Refused database URL "${url.protocol}//": the URL has no host. ` +
        'Provide a full connection string such as postgresql://user:password@localhost:5433/wealthhabit_test.'
    );
  }

  if (!databaseNameOf(url)) {
    throw new UnsafeDatabaseError(
      `[db-safety] Refused database target "${describeTarget(url)}": the URL path does not contain a ` +
        'database name. Add one, for example .../wealthhabit_test.'
    );
  }

  return { target: value, url };
}

const TEST_MISSING_FIX =
  'Set TEST_DATABASE_URL (recommended) or DATABASE_URL in server/.env; see server/.env.example. ' +
  'A safe local target is postgresql://localhost:5433/wealthhabit_test.';

export function assertSafeTestDatabaseUrl(
  raw: string | undefined,
  env: EnvLike = process.env
): string {
  const { target, url } = ensurePostgresUrl(raw, TEST_MISSING_FIX);
  const description = describeTarget(url);
  const hostname = hostnameOf(url);
  const databaseName = databaseNameOf(url);

  if (env.NODE_ENV !== 'test') {
    throw new UnsafeDatabaseError(
      `[db-safety] Refused database target "${description}": NODE_ENV is "` +
        `${env.NODE_ENV ?? 'unset'}" but automated tests require NODE_ENV=test. ` +
        'Run the suite through the test runner (for example "npm test"), which sets NODE_ENV=test.'
    );
  }

  if (PRODUCTION_DATABASE_NAMES.has(databaseName)) {
    throw new UnsafeDatabaseError(
      `[db-safety] Refused database target "${description}": "${databaseName}" is the production ` +
        'database name. Automated tests must use a dedicated database whose name ends with "_test" ' +
        '(for example wealthhabit_test on localhost).'
    );
  }

  if (!databaseName.endsWith('_test')) {
    throw new UnsafeDatabaseError(
      `[db-safety] Refused database target "${description}": the database name must end with "_test". ` +
        'Use a dedicated test database such as wealthhabit_test, or set TEST_DATABASE_URL.'
    );
  }

  if (isAwsHost(hostname)) {
    throw new UnsafeDatabaseError(
      `[db-safety] Refused database target "${description}": the host is an AWS endpoint. ` +
        'Automated tests may never target AWS-hosted databases and this cannot be overridden. ' +
        'Run tests against a local *_test database instead.'
    );
  }

  if (!isLocalHost(hostname) && env.ALLOW_REMOTE_TEST_DB !== '1') {
    throw new UnsafeDatabaseError(
      `[db-safety] Refused database target "${description}": the host is not a local test host. ` +
        'By default tests only run against localhost. To allow a non-AWS remote *_test database, set ' +
        'ALLOW_REMOTE_TEST_DB=1 explicitly; never point tests at production.'
    );
  }

  return target;
}

export function assertSafeE2EDatabaseUrl(
  raw: string | undefined,
  env: EnvLike = process.env
): string {
  const { target, url } = ensurePostgresUrl(
    raw,
    'Set DATABASE_URL in server/.env (see server/.env.example) so the E2E scripts know which ' +
      'database the API under test writes to, then set E2E_ALLOW_DB=1 if that target is not a ' +
      'local *_test database.'
  );
  const description = describeTarget(url);
  const hostname = hostnameOf(url);
  const databaseName = databaseNameOf(url);

  if (env.NODE_ENV === 'production') {
    throw new UnsafeDatabaseError(
      `[db-safety] Refused database target "${description}": NODE_ENV=production is never allowed ` +
        'for E2E scripts. Run E2E scripts with a development or test NODE_ENV.'
    );
  }

  const local = isLocalHost(hostname);
  const localTestTarget = local && databaseName.endsWith('_test');

  if (localTestTarget) {
    return target;
  }

  if (env.E2E_ALLOW_DB !== '1') {
    throw new UnsafeDatabaseError(
      `[db-safety] Refused database target "${description}": it does not satisfy the local test ` +
        'rules (localhost host and a database name ending in "_test") and E2E_ALLOW_DB=1 is not set. ' +
        'Either point DATABASE_URL at a local *_test database, or set E2E_ALLOW_DB=1 to explicitly ' +
        'opt in to this database.'
    );
  }

  if (!local && PRODUCTION_DATABASE_NAMES.has(databaseName)) {
    throw new UnsafeDatabaseError(
      `[db-safety] Refused database target "${description}": "${databaseName}" is the production ` +
        'database name on a non-local host. E2E_ALLOW_DB=1 does not authorize the production ' +
        'database. Use a local database or a non-production database name.'
    );
  }

  return target;
}

export function resolveTestDatabaseUrl(env: EnvLike = process.env, options: ResolveOptions = {}): string {
  const explicit = env.TEST_DATABASE_URL?.trim();
  if (explicit) {
    return assertSafeTestDatabaseUrl(explicit, env);
  }

  const configured = env.DATABASE_URL?.trim();
  if (configured) {
    let parsed: URL;
    try {
      parsed = new URL(configured);
    } catch {
      throw new UnsafeDatabaseError(
        '[db-safety] DATABASE_URL is set but is not a parseable URL, so the test database cannot ' +
          'be resolved safely. Fix DATABASE_URL or set TEST_DATABASE_URL explicitly; see ' +
          'server/.env.example.'
      );
    }

    const configuredName = databaseNameOf(parsed);
    if (isLocalHost(hostnameOf(parsed)) && configuredName) {
      if (!configuredName.endsWith('_test')) {
        parsed.pathname = `/${configuredName}_test`;
      }
      return assertSafeTestDatabaseUrl(parsed.toString(), env);
    }

    options.onSkipConfigured?.(describeTarget(parsed));
  }

  return assertSafeTestDatabaseUrl(SAFE_LOCAL_TEST_DATABASE_URL, env);
}
