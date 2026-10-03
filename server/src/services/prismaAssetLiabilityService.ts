import { Asset, Liability, Prisma } from '@prisma/client';
import {
  CreateAssetInput,
  CreateLiabilityInput,
  ListAssetsQuery,
  ListLiabilitiesQuery,
  UpdateAssetInput,
  UpdateLiabilityInput,
} from '../schemas/assetLiabilitySchemas.js';
import { prisma } from '../config/prisma.js';
import { ZERO } from '../utils/money.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_LIST_PAGE_SIZE = 50;

export interface AssetListResult {
  assets: Asset[];
  total: number;
}

export interface LiabilityListResult {
  liabilities: Liability[];
  total: number;
}

export interface AssetsLiabilitiesAggregate {
  totalAssets: Prisma.Decimal;
  assetCount: number;
  totalLiabilities: Prisma.Decimal;
  liabilityCount: number;
}

function pageWindow(query?: { page?: number; pageSize?: number }) {
  const page = query?.page ?? 1;
  const pageSize = Math.min(query?.pageSize ?? DEFAULT_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function createAsset(
  userId: string,
  input: CreateAssetInput
): Promise<Asset> {
  return prisma.asset.create({
    data: {
      userId,
      name: input.name,
      type: input.type ?? 'OTHER',
      currentValue: input.currentValue,
      notes: input.notes ?? null,
    },
  });
}

export async function listUserAssets(
  userId: string,
  query?: ListAssetsQuery
): Promise<AssetListResult> {
  const { skip, pageSize } = pageWindow(query);

  const where: Prisma.AssetWhereInput = { userId };
  if (query?.type) {
    where.type = query.type;
  }

  const [total, assets] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: pageSize,
    }),
  ]);

  return { assets, total };
}

export async function findUserAsset(
  id: string,
  userId: string
): Promise<Asset | null> {
  return prisma.asset.findFirst({
    where: { id, userId },
  });
}

/**
 * Only the validated, explicitly mapped fields are written. `userId` is never
 * accepted from the payload and no request body is spread into Prisma.
 */
export async function updateAsset(
  existing: Asset,
  input: UpdateAssetInput
): Promise<Asset> {
  const data: Prisma.AssetUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.currentValue !== undefined) data.currentValue = input.currentValue;
  if (input.notes !== undefined) data.notes = input.notes;

  return prisma.asset.update({
    where: { id: existing.id },
    data,
  });
}

export async function deleteAsset(id: string): Promise<void> {
  // Assets have no dependent rows: transactions, goals and contributions are
  // separate tables with no foreign key to assets.
  await prisma.asset.delete({ where: { id } });
}

export async function createLiability(
  userId: string,
  input: CreateLiabilityInput
): Promise<Liability> {
  return prisma.liability.create({
    data: {
      userId,
      name: input.name,
      type: input.type ?? 'OTHER',
      outstandingAmount: input.outstandingAmount,
      notes: input.notes ?? null,
    },
  });
}

export async function listUserLiabilities(
  userId: string,
  query?: ListLiabilitiesQuery
): Promise<LiabilityListResult> {
  const { skip, pageSize } = pageWindow(query);

  const where: Prisma.LiabilityWhereInput = { userId };
  if (query?.type) {
    where.type = query.type;
  }

  const [total, liabilities] = await Promise.all([
    prisma.liability.count({ where }),
    prisma.liability.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: pageSize,
    }),
  ]);

  return { liabilities, total };
}

export async function findUserLiability(
  id: string,
  userId: string
): Promise<Liability | null> {
  return prisma.liability.findFirst({
    where: { id, userId },
  });
}

export async function updateLiability(
  existing: Liability,
  input: UpdateLiabilityInput
): Promise<Liability> {
  const data: Prisma.LiabilityUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.outstandingAmount !== undefined) {
    data.outstandingAmount = input.outstandingAmount;
  }
  if (input.notes !== undefined) data.notes = input.notes;

  return prisma.liability.update({
    where: { id: existing.id },
    data,
  });
}

export async function deleteLiability(id: string): Promise<void> {
  // Liabilities have no dependent rows and no link to transactions or goals.
  await prisma.liability.delete({ where: { id } });
}

/**
 * Two SQL aggregates over the caller's own rows (no N+1, no per-row reads).
 * Totals stay in Prisma.Decimal until serialization — no float arithmetic.
 * The two sums are deliberately kept separate: Net Worth (Assets −
 * Liabilities) is derived from them in prismaWealthSnapshotService.
 *
 * Both aggregates run inside one RepeatableRead transaction so they observe a
 * single database snapshot: under READ COMMITTED each statement takes its own
 * snapshot and a concurrent asset/liability write could make the totals and
 * counts disagree with each other.
 */
export async function getAssetsLiabilitiesAggregate(
  userId: string
): Promise<AssetsLiabilitiesAggregate> {
  const [assetAggregate, liabilityAggregate] = await prisma.$transaction(
    async (tx) => {
      const assets = await tx.asset.aggregate({
        where: { userId },
        _sum: { currentValue: true },
        _count: { _all: true },
      });
      const liabilities = await tx.liability.aggregate({
        where: { userId },
        _sum: { outstandingAmount: true },
        _count: { _all: true },
      });

      return [assets, liabilities] as const;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );

  return {
    totalAssets: assetAggregate._sum.currentValue ?? ZERO,
    assetCount: assetAggregate._count._all,
    totalLiabilities: liabilityAggregate._sum.outstandingAmount ?? ZERO,
    liabilityCount: liabilityAggregate._count._all,
  };
}
