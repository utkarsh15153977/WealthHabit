import { Request, Response } from 'express';
import { HealthResponse } from '../types/api.js';
import { checkDatabaseHealth } from '../services/adminSystemHealthService.js';
import { logger } from '../utils/logger.js';
import { ensureRequestId } from '../middleware/requestId.js';

export const healthCheck = (_req: Request, res: Response<HealthResponse>) => {
  res.json({
    success: true,
    message: 'WealthHabit API is running',
  });
};

/**
 * Readiness probe: verifies the database dependency with the existing
 * SELECT 1 health helper.
 *
 * - 200 when the database is reachable.
 * - 503 with a fixed, credential-free payload otherwise.
 *
 * The check never surfaces driver errors, connection strings or stack
 * traces — the reused helper already swallows the raw error. The explicit
 * try/catch keeps an unexpected failure from rejecting an async handler
 * (Express 4 does not catch rejected promises, which would trip the
 * unhandledRejection shutdown handler from 5G.3).
 */
export const readinessCheck = async (
  req: Request,
  res: Response<HealthResponse>
): Promise<void> => {
  let ready = false;

  try {
    const database = await checkDatabaseHealth();
    ready = database.status === 'HEALTHY';
  } catch {
    ready = false;
  }

  if (ready) {
    res.status(200).json({
      success: true,
      message: 'WealthHabit API is ready',
    });
    return;
  }

  // 5G.4 structured log: only the request ID and status — no database
  // details, no error message, no stack trace.
  logger.error('Readiness check failed', {
    requestId: ensureRequestId(req, res),
    status: 503,
  });

  res.status(503).json({
    success: false,
    message: 'Service unavailable',
  });
};
