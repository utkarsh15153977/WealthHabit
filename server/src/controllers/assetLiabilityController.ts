import { Response } from 'express';
import { Asset, Liability } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  CreateAssetInput,
  CreateLiabilityInput,
  ListAssetsQuery,
  ListLiabilitiesQuery,
  UpdateAssetInput,
  UpdateLiabilityInput,
} from '../schemas/assetLiabilitySchemas.js';
import {
  createAsset,
  createLiability,
  deleteAsset,
  deleteLiability,
  findUserAsset,
  findUserLiability,
  listUserAssets,
  listUserLiabilities,
  updateAsset,
  updateLiability,
} from '../services/prismaAssetLiabilityService.js';
import { getNetWorth } from '../services/prismaWealthSnapshotService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { roundMoney, ZERO } from '../utils/money.js';
import {
  AssetData,
  AssetListData,
  AssetStatus,
  AssetType,
  AssetsLiabilitiesSummaryData,
  LiabilityData,
  LiabilityListData,
  LiabilityStatus,
  LiabilityType,
} from '../types/assetLiability.js';

function toAssetData(asset: Asset): AssetData {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type as AssetType,
    currentValue: roundMoney(asset.currentValue),
    notes: asset.notes,
    // Derived, never stored: the Asset model has no lifecycle column.
    status: 'ACTIVE' as AssetStatus,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function toLiabilityData(liability: Liability): LiabilityData {
  return {
    id: liability.id,
    name: liability.name,
    type: liability.type as LiabilityType,
    outstandingAmount: roundMoney(liability.outstandingAmount),
    notes: liability.notes,
    // Derived from the balance, never stored: 0 outstanding means repaid.
    status: liability.outstandingAmount.gt(ZERO)
      ? ('ACTIVE' as LiabilityStatus)
      : ('PAID_OFF' as LiabilityStatus),
    createdAt: liability.createdAt,
    updatedAt: liability.updatedAt,
  };
}

async function findAssetOrThrow(id: string, userId: string): Promise<Asset> {
  const asset = await findUserAsset(id, userId);
  if (!asset) {
    throw new AppError(
      'Asset not found',
      404,
      undefined,
      ApiErrorCodes.ASSET_NOT_FOUND
    );
  }
  return asset;
}

async function findLiabilityOrThrow(
  id: string,
  userId: string
): Promise<Liability> {
  const liability = await findUserLiability(id, userId);
  if (!liability) {
    throw new AppError(
      'Liability not found',
      404,
      undefined,
      ApiErrorCodes.LIABILITY_NOT_FOUND
    );
  }
  return liability;
}

export async function createAssetHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateAssetInput;

  const asset = await createAsset(userId, input);

  res.status(201).json({
    success: true,
    data: { asset: toAssetData(asset) },
  });
}

export async function listAssetsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListAssetsQuery;

  const result = await listUserAssets(userId, query);

  const data: AssetListData = {
    assets: result.assets.map(toAssetData),
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    total: result.total,
  };

  res.json({ success: true, data });
}

export async function getAssetHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const asset = await findAssetOrThrow(id, userId);

  res.json({
    success: true,
    data: { asset: toAssetData(asset) },
  });
}

export async function updateAssetHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateAssetInput;

  const existing = await findAssetOrThrow(id, userId);
  const asset = await updateAsset(existing, input);

  res.json({
    success: true,
    data: { asset: toAssetData(asset) },
  });
}

export async function deleteAssetHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await findAssetOrThrow(id, userId);
  await deleteAsset(existing.id);

  res.json({
    success: true,
    data: { message: 'Asset deleted' },
  });
}

export async function createLiabilityHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateLiabilityInput;

  const liability = await createLiability(userId, input);

  res.status(201).json({
    success: true,
    data: { liability: toLiabilityData(liability) },
  });
}

export async function listLiabilitiesHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListLiabilitiesQuery;

  const result = await listUserLiabilities(userId, query);

  const data: LiabilityListData = {
    liabilities: result.liabilities.map(toLiabilityData),
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    total: result.total,
  };

  res.json({ success: true, data });
}

export async function getLiabilityHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const liability = await findLiabilityOrThrow(id, userId);

  res.json({
    success: true,
    data: { liability: toLiabilityData(liability) },
  });
}

export async function updateLiabilityHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateLiabilityInput;

  const existing = await findLiabilityOrThrow(id, userId);
  const liability = await updateLiability(existing, input);

  res.json({
    success: true,
    data: { liability: toLiabilityData(liability) },
  });
}

export async function deleteLiabilityHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await findLiabilityOrThrow(id, userId);
  await deleteLiability(existing.id);

  res.json({
    success: true,
    data: { message: 'Liability deleted' },
  });
}

export async function getAssetsLiabilitiesSummaryHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const aggregate = await getNetWorth(userId);

  // Independent totals plus the derived Net Worth for the same live rows —
  // one aggregation endpoint, no separate net-worth API (Phase 5C).
  const data: AssetsLiabilitiesSummaryData = {
    totalAssets: roundMoney(aggregate.totalAssets),
    totalLiabilities: roundMoney(aggregate.totalLiabilities),
    netWorth: roundMoney(aggregate.netWorth),
    assetCount: aggregate.assetCount,
    liabilityCount: aggregate.liabilityCount,
  };

  res.json({ success: true, data });
}
