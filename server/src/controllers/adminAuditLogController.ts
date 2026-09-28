import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import type { ListAuditLogsQuery } from '../schemas/adminAuditLogSchemas.js';
import { listAuditLogs } from '../services/adminAuditLogService.js';

export async function listAuditLogsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const query = (req.query ?? {}) as ListAuditLogsQuery;

  const result = await listAuditLogs(query);

  res.json({
    success: true,
    data: result,
  });
}
