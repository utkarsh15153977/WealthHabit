import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import type { AnalyticsRange } from '../schemas/wealthAnalyticsSchemas.js';
import {
  getAnalyticsSummaryData,
  getAssetAnalyticsData,
  getCashFlowAnalyticsData,
  getLiabilityAnalyticsData,
  getNetWorthAnalyticsData,
} from '../services/prismaWealthAnalyticsService.js';

/**
 * Every handler is a read-only GET. The user id comes from the token only and
 * ranges are already coerced, defaulted and bounded by the route schema, so
 * the request contributes no financial value of its own.
 */
function rangeFromRequest(req: AuthenticatedRequest): AnalyticsRange {
  return (req.query ?? {}) as unknown as AnalyticsRange;
}

export async function getAnalyticsSummaryHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const data = await getAnalyticsSummaryData(userId);

  res.json({ success: true, data });
}

export async function getNetWorthAnalyticsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const data = await getNetWorthAnalyticsData(userId, rangeFromRequest(req));

  res.json({ success: true, data });
}

export async function getAssetAnalyticsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const data = await getAssetAnalyticsData(userId);

  res.json({ success: true, data });
}

export async function getLiabilityAnalyticsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const data = await getLiabilityAnalyticsData(userId);

  res.json({ success: true, data });
}

export async function getCashFlowAnalyticsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const data = await getCashFlowAnalyticsData(userId, rangeFromRequest(req));

  res.json({ success: true, data });
}
