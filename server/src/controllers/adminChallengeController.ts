import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import {
  getAdminChallengeDetail,
  listAdminChallenges,
} from '../services/adminChallengeService.js';
import type { ListAdminChallengesQuery } from '../schemas/adminChallengeSchemas.js';

export async function listAdminChallengesHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const query = (req.query ?? {}) as ListAdminChallengesQuery;
  const data = await listAdminChallenges(query);
  res.json({ success: true, data });
}

export async function getAdminChallengeHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const { id } = req.params as { id: string };
  const challenge = await getAdminChallengeDetail(id);
  res.json({ success: true, data: { challenge } });
}
