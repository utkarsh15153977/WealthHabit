import { Response } from 'express';
import { WealthSnapshot } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import { ListWealthSnapshotsQuery } from '../schemas/wealthSnapshotSchemas.js';
import {
  createTodayWealthSnapshot,
  findUserWealthSnapshot,
  listUserWealthSnapshots,
} from '../services/prismaWealthSnapshotService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { roundMoney } from '../utils/money.js';
import {
  WealthSnapshotData,
  WealthSnapshotListData,
} from '../types/wealthSnapshot.js';

/**
 * Snapshots are immutable: the serializer maps stored values only and derives
 * nothing new. Money leaves as a rounded number, dates as the stored UTC day.
 */
function toWealthSnapshotData(snapshot: WealthSnapshot): WealthSnapshotData {
  return {
    id: snapshot.id,
    snapshotDate: snapshot.snapshotDate,
    totalAssets: roundMoney(snapshot.totalAssets),
    totalLiabilities: roundMoney(snapshot.totalLiabilities),
    netWorth: roundMoney(snapshot.netWorth),
  };
}

export async function createWealthSnapshotHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const { snapshot, created } = await createTodayWealthSnapshot(userId);

  res.status(created ? 201 : 200).json({
    success: true,
    data: { snapshot: toWealthSnapshotData(snapshot), created },
  });
}

export async function listWealthSnapshotsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListWealthSnapshotsQuery;

  const result = await listUserWealthSnapshots(userId, query);

  const data: WealthSnapshotListData = {
    snapshots: result.snapshots.map(toWealthSnapshotData),
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    total: result.total,
  };

  res.json({ success: true, data });
}

export async function getWealthSnapshotHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const snapshot = await findUserWealthSnapshot(id, userId);
  if (!snapshot) {
    throw new AppError(
      'Wealth snapshot not found',
      404,
      undefined,
      ApiErrorCodes.WEALTH_SNAPSHOT_NOT_FOUND
    );
  }

  res.json({
    success: true,
    data: { snapshot: toWealthSnapshotData(snapshot) },
  });
}
