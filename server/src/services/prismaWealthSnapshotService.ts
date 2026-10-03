import { Prisma, WealthSnapshot } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { ListWealthSnapshotsQuery } from '../schemas/wealthSnapshotSchemas.js';
import {
  AssetsLiabilitiesAggregate,
  getAssetsLiabilitiesAggregate,
} from './prismaAssetLiabilityService.js';
import { startOfUtcDay } from '../utils/date.js';
import { ZERO } from '../utils/money.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_LIST_PAGE_SIZE = 50;

export interface NetWorthAggregate extends AssetsLiabilitiesAggregate {
  netWorth: Prisma.Decimal;
}

export interface WealthSnapshotListResult {
  snapshots: WealthSnapshot[];
  total: number;
}

export interface CreateWealthSnapshotResult {
  snapshot: WealthSnapshot;
  created: boolean;
}

/**
 * Net Worth = Total Assets − Total Liabilities, computed live from the
 * caller's current Phase 5B rows. It is never read from a stored snapshot,
 * never built from transactions or goal contributions, and never clamped:
 * liabilities larger than assets yield a genuinely negative net worth.
 * Arithmetic stays in Prisma.Decimal until serialization.
 */
export async function getNetWorth(userId: string): Promise<NetWorthAggregate> {
  const aggregate = await getAssetsLiabilitiesAggregate(userId);

  return {
    ...aggregate,
    netWorth: aggregate.totalAssets.minus(aggregate.totalLiabilities),
  };
}

/**
 * Race-safe by construction: `wealth_snapshots_userId_snapshotDate_key`
 * (userId, snapshotDate) is the authority. A concurrent duplicate hits P2002
 * and is turned into an idempotent "already captured" result — never a 500.
 */
export async function createTodayWealthSnapshot(
  userId: string
): Promise<CreateWealthSnapshotResult> {
  const snapshotDate = startOfUtcDay(new Date());

  try {
    // RepeatableRead: both aggregates and the insert share one database
    // snapshot. Under the default READ COMMITTED every statement gets its own
    // snapshot, so a persisted capture could otherwise mix assets and
    // liabilities read from two different database states.
    const snapshot = await prisma.$transaction(
      async (tx) => {
        const assetAggregate = await tx.asset.aggregate({
          where: { userId },
          _sum: { currentValue: true },
        });
        const liabilityAggregate = await tx.liability.aggregate({
          where: { userId },
          _sum: { outstandingAmount: true },
        });

        const totalAssets = assetAggregate._sum.currentValue ?? ZERO;
        const totalLiabilities = liabilityAggregate._sum.outstandingAmount ?? ZERO;

        return tx.wealthSnapshot.create({
          data: {
            userId,
            snapshotDate,
            totalAssets,
            totalLiabilities,
            netWorth: totalAssets.minus(totalLiabilities),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );

    return { snapshot, created: true };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await prisma.wealthSnapshot.findUnique({
        where: { userId_snapshotDate: { userId, snapshotDate } },
      });

      if (existing) {
        return { snapshot: existing, created: false };
      }
    }
    throw error;
  }
}

export async function listUserWealthSnapshots(
  userId: string,
  query?: ListWealthSnapshotsQuery
): Promise<WealthSnapshotListResult> {
  const page = query?.page ?? 1;
  const pageSize = Math.min(
    query?.pageSize ?? DEFAULT_PAGE_SIZE,
    MAX_LIST_PAGE_SIZE
  );

  const [total, snapshots] = await Promise.all([
    prisma.wealthSnapshot.count({ where: { userId } }),
    prisma.wealthSnapshot.findMany({
      where: { userId },
      orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { snapshots, total };
}

export async function findUserWealthSnapshot(
  id: string,
  userId: string
): Promise<WealthSnapshot | null> {
  return prisma.wealthSnapshot.findFirst({
    where: { id, userId },
  });
}
