import { prisma } from '../config/prisma.js';
import { env } from '../config/index.js';
import type {
  ApplicationHealth,
  DatabaseHealth,
  HealthEnvironment,
  HealthStatus,
  RuntimeHealth,
  SystemHealthData,
} from '../types/adminSystemHealth.js';

export const SYSTEM_HEALTH_SERVICE_NAME = 'WealthHabit API';

/**
 * Documented thresholds — plain constants, not a capacity-management
 * system. The runtime component is DEGRADED once the V8 heap is at least
 * 95% used relative to the current heap total; everything below that is
 * HEALTHY. The database component is either HEALTHY or UNHEALTHY (there is
 * no meaningful "slow but connected" state for a single SELECT 1).
 */
export const MEMORY_DEGRADED_RATIO = 0.95;

/** Fixed, credential-free text returned when the database check fails. */
export const DATABASE_FAILURE_MESSAGE = 'Database health check failed';

type DatabaseQueryRunner = () => Promise<unknown>;

/**
 * The only database interaction of this feature: one minimal read-only
 * query against the existing Prisma connection (SELECT 1). It never
 * touches tables, never writes, and its duration is the source of
 * `database.latencyMs` — health-query latency only, not general
 * application latency.
 */
const defaultDatabaseQuery: DatabaseQueryRunner = async () =>
  prisma.$queryRaw`SELECT 1`;

/**
 * Runs the database health query through the provided runner. The runner
 * is injectable so failure handling can be tested without touching the
 * real database. Failures are swallowed into a safe UNHEALTHY result —
 * the raw driver error (which may contain connection strings) is never
 * returned, only logged server-side as a fixed message.
 */
export async function checkDatabaseHealth(
  runQuery: DatabaseQueryRunner = defaultDatabaseQuery
): Promise<DatabaseHealth> {
  const startedAt = Date.now();
  try {
    await runQuery();
    return {
      status: 'HEALTHY',
      latencyMs: Math.max(0, Date.now() - startedAt),
      message: null,
    };
  } catch {
    console.error('System health: database health check failed');
    return {
      status: 'UNHEALTHY',
      latencyMs: null,
      message: DATABASE_FAILURE_MESSAGE,
    };
  }
}

function toMb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function checkApplication(): ApplicationHealth {
  const environment: HealthEnvironment = env.isProduction
    ? 'production'
    : env.NODE_ENV === 'test'
      ? 'test'
      : 'development';

  // Serving this request proves the API process is up, so the
  // application component is HEALTHY by construction.
  return {
    status: 'HEALTHY',
    service: SYSTEM_HEALTH_SERVICE_NAME,
    environment,
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

function checkRuntime(): RuntimeHealth {
  const usage = process.memoryUsage();
  const heapRatio =
    usage.heapTotal > 0 ? usage.heapUsed / usage.heapTotal : 0;

  return {
    status: heapRatio >= MEMORY_DEGRADED_RATIO ? 'DEGRADED' : 'HEALTHY',
    nodeVersion: process.versions.node.split('.').slice(0, 2).join('.'),
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rssMb: toMb(usage.rss),
      heapUsedMb: toMb(usage.heapUsed),
      heapTotalMb: toMb(usage.heapTotal),
    },
  };
}

/**
 * Deterministic aggregation over the implemented components only:
 *   - any component UNHEALTHY  → UNHEALTHY (the database is a critical
 *     dependency, so a failed database check makes the system unhealthy
 *     even though the API process is still serving requests)
 *   - no component unhealthy but at least one DEGRADED → DEGRADED
 *   - all components HEALTHY → HEALTHY
 */
export function deriveOverallStatus(components: {
  application: Pick<ApplicationHealth, 'status'>;
  database: Pick<DatabaseHealth, 'status'>;
  runtime: Pick<RuntimeHealth, 'status'>;
}): HealthStatus {
  const statuses = [
    components.application.status,
    components.database.status,
    components.runtime.status,
  ];
  if (statuses.includes('UNHEALTHY')) {
    return 'UNHEALTHY';
  }
  if (statuses.includes('DEGRADED')) {
    return 'DEGRADED';
  }
  return 'HEALTHY';
}

/**
 * Builds the full, allowlisted health report. This is an operational
 * dashboard read — not a liveness/readiness probe. It performs exactly
 * one lightweight database query plus O(1) process introspection, writes
 * no audit rows and no application data of any kind.
 */
export async function getSystemHealth(): Promise<SystemHealthData> {
  const application = checkApplication();
  const database = await checkDatabaseHealth();
  const runtime = checkRuntime();

  return {
    status: deriveOverallStatus({ application, database, runtime }),
    generatedAt: new Date().toISOString(),
    application,
    database,
    runtime,
  };
}
