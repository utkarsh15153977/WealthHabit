import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAdminDashboardData } from '../services/adminDashboardService.js';
import type { AdminDashboardData } from '../types/adminDashboard.js';

export async function getAdminDashboardHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const data: AdminDashboardData = await getAdminDashboardData();

  res.json({
    success: true,
    data,
  });
}