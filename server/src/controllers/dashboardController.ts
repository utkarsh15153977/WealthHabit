import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import { DashboardSummaryQuery } from '../schemas/dashboardSchemas.js';
import { getDashboardSummaryData } from '../services/prismaDashboardService.js';
import { DashboardSummaryData } from '../types/dashboard.js';

export async function getDashboardSummaryHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as DashboardSummaryQuery;

  const data: DashboardSummaryData = await getDashboardSummaryData(userId, query);

  res.json({
    success: true,
    data,
  });
}
