import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getSystemHealth } from '../services/adminSystemHealthService.js';
import type { SystemHealthData } from '../types/adminSystemHealth.js';

export async function getSystemHealthHandler(
  _req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const data: SystemHealthData = await getSystemHealth();

  res.json({
    success: true,
    data,
  });
}
