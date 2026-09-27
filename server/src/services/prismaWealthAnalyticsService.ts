import { Prisma, TransactionType } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import type { AnalyticsRange } from '../schemas/wealthAnalyticsSchemas.js';
import { listUserGoals } from './prismaGoalService.js';
import { getNetWorth } from './prismaWealthSnapshotService.js';
import { addUtcDays } from '../utils/date.js';
import { ZERO, goalProgressValues, roundMoney, roundRate } from '../utils/money.js';
import type {
  AnalyticsRangeData,
  AnalyticsSummaryData,
  AssetAnalyticsData,
  CashFlowAnalyticsData,
  CurrentPositionData,
  GoalsAnalyticsData,
  LiabilityAnalyticsData,
  NetWorthAnalyticsData,
} from '../types/wealthAnalytics.js';

/**
 * Wealth Analytics is a read-only derived view over the authoritative Phase
 * 5A/5B/5C records. Nothing in this module writes to the database: no
 * snapshots are created, no financial row is mutated, and every figure is
 * computed with Prisma.Decimal from rows owned by the authenticated user.
 */

function shareOf(value: Prisma.Decimal, total: Prisma.Decimal): number {
  return total.isZero() ? 0 : roundRate(value.dividedBy(total).times(100));
}

function toRangeData(range: AnalyticsRange): AnalyticsRangeData {
  return {
    dateFrom: range.dateFrom.toISOString(),
    dateTo: range.dateTo.toISOString(),
    timezone: 'UTC',
  };
}

/**
 * Current position = live Asset and Liability aggregates via the existing
 * Phase 5C `getNetWorth` service. Never read from a stored snapshot.
 */
export async function getCurrentPositionData(
  userId: string
): Promise<CurrentPositionData> {
  const aggregate = await getNetWorth(userId);

  return {
    totalAssets: roundMoney(aggregate.totalAssets),
    totalLiabilities: roundMoney(aggregate.totalLiabilities),
    netWorth: roundMoney(aggregate.netWorth),
    assetCount: aggregate.assetCount,
    liabilityCount: aggregate.liabilityCount,
  };
}

/**
 * Goal analytics reuse `listUserGoals` (the canonical Phase 5A query plan and
 * progress math) rather than a second aggregation. Only `completedCount` is an
 * extra COUNT over the stored, already-maintained `status` column. Totals span
 * all goals, exactly like the Goals list meta. Contributions are never treated
 * as assets and never enter net worth.
 */
export async function getGoalsAnalyticsData(
  userId: string
): Promise<GoalsAnalyticsData> {
  const [result, completedCount] = await Promise.all([
    listUserGoals(userId, { page: 1, pageSize: 50 }),
    prisma.savingsGoal.count({ where: { userId, status: 'COMPLETED' } }),
  ]);

  const { rows, meta } = result;
  const { progressPercent } = goalProgressValues(
    meta.totalSavedAmount,
    meta.totalTargetAmount
  );

  return {
    goalCount: meta.total,
    activeCount: meta.activeCount,
    completedCount,
    totalTargetAmount: roundMoney(meta.totalTargetAmount),
    totalSavedAmount: roundMoney(meta.totalSavedAmount),
    progressPercent,
    items: rows.map((goal) => {
      const values = goalProgressValues(goal.savedAmount, goal.targetAmount);
      return {
        goalId: goal.id,
        name: goal.name,
        targetAmount: roundMoney(goal.targetAmount),
        currentAmount: roundMoney(goal.savedAmount),
        progressPercent: values.progressPercent,
        targetDate: goal.targetDate,
        status: goal.status,
      };
    }),
  };
}

export async function getAnalyticsSummaryData(
  userId: string
): Promise<AnalyticsSummaryData> {
  const [current, goals] = await Promise.all([
    getCurrentPositionData(userId),
    getGoalsAnalyticsData(userId),
  ]);

  return { current, goals };
}

/**
 * Net Worth history reads stored WealthSnapshot rows only — never a
 * reconstruction from today's assets/liabilities, and never an interpolated
 * point for a day without a snapshot. `change` compares the earliest and
 * latest snapshot in range; it is labelled Net Worth Change, not profit or
 * return. Percentage is null unless the earliest net worth is positive.
 */
export async function getNetWorthAnalyticsData(
  userId: string,
  range: AnalyticsRange
): Promise<NetWorthAnalyticsData> {
  const snapshots = await prisma.wealthSnapshot.findMany({
    where: {
      userId,
      snapshotDate: { gte: range.dateFrom, lte: range.dateTo },
    },
    orderBy: [{ snapshotDate: 'asc' }, { id: 'asc' }],
    select: {
      snapshotDate: true,
      totalAssets: true,
      totalLiabilities: true,
      netWorth: true,
    },
  });

  let absolute: number | null = null;
  let percentage: number | null = null;

  if (snapshots.length >= 2) {
    const earliest = snapshots[0].netWorth;
    const latest = snapshots[snapshots.length - 1].netWorth;
    const delta = latest.minus(earliest);
    absolute = roundMoney(delta);
    if (earliest.gt(ZERO)) {
      percentage = roundRate(delta.dividedBy(earliest).times(100));
    }
  }

  return {
    range: toRangeData(range),
    history: snapshots.map((snapshot) => ({
      snapshotDate: snapshot.snapshotDate,
      totalAssets: roundMoney(snapshot.totalAssets),
      totalLiabilities: roundMoney(snapshot.totalLiabilities),
      netWorth: roundMoney(snapshot.netWorth),
    })),
    change: { absolute, percentage },
  };
}

/**
 * Three flat queries (groupBy types, one findMany, one aggregate) — no N+1.
 * Percentages are derived here and never stored on any asset.
 */
export async function getAssetAnalyticsData(
  userId: string
): Promise<AssetAnalyticsData> {
  const [groups, assets, aggregate] = await Promise.all([
    prisma.asset.groupBy({
      by: ['type'],
      where: { userId },
      _sum: { currentValue: true },
    }),
    prisma.asset.findMany({
      where: { userId },
      select: { id: true, name: true, type: true, currentValue: true },
      orderBy: [{ currentValue: 'desc' }, { id: 'asc' }],
    }),
    prisma.asset.aggregate({
      where: { userId },
      _sum: { currentValue: true },
      _count: { _all: true },
    }),
  ]);

  const totalAssets = aggregate._sum.currentValue ?? ZERO;
  const assetCount = aggregate._count._all;

  const byType = groups
    .map((group) => ({
      type: group.type,
      totalValue: group._sum.currentValue ?? ZERO,
    }))
    .sort((a, b) => {
      const cmp = b.totalValue.comparedTo(a.totalValue);
      if (cmp !== 0) {
        return cmp;
      }
      return a.type.localeCompare(b.type);
    })
    .map((group) => ({
      type: group.type,
      totalValue: roundMoney(group.totalValue),
      percentage: shareOf(group.totalValue, totalAssets),
    }));

  return {
    totalAssets: roundMoney(totalAssets),
    assetCount,
    byType,
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      currentValue: roundMoney(asset.currentValue),
      percentage: shareOf(asset.currentValue, totalAssets),
    })),
  };
}

export async function getLiabilityAnalyticsData(
  userId: string
): Promise<LiabilityAnalyticsData> {
  const [groups, liabilities, aggregate] = await Promise.all([
    prisma.liability.groupBy({
      by: ['type'],
      where: { userId },
      _sum: { outstandingAmount: true },
    }),
    prisma.liability.findMany({
      where: { userId },
      select: { id: true, name: true, type: true, outstandingAmount: true },
      orderBy: [{ outstandingAmount: 'desc' }, { id: 'asc' }],
    }),
    prisma.liability.aggregate({
      where: { userId },
      _sum: { outstandingAmount: true },
      _count: { _all: true },
    }),
  ]);

  const totalLiabilities = aggregate._sum.outstandingAmount ?? ZERO;
  const liabilityCount = aggregate._count._all;

  const byType = groups
    .map((group) => ({
      type: group.type,
      totalBalance: group._sum.outstandingAmount ?? ZERO,
    }))
    .sort((a, b) => {
      const cmp = b.totalBalance.comparedTo(a.totalBalance);
      if (cmp !== 0) {
        return cmp;
      }
      return a.type.localeCompare(b.type);
    })
    .map((group) => ({
      type: group.type,
      totalBalance: roundMoney(group.totalBalance),
      percentage: shareOf(group.totalBalance, totalLiabilities),
    }));

  return {
    totalLiabilities: roundMoney(totalLiabilities),
    liabilityCount,
    byType,
    liabilities: liabilities.map((liability) => ({
      id: liability.id,
      name: liability.name,
      type: liability.type,
      outstandingBalance: roundMoney(liability.outstandingAmount),
      percentage: shareOf(liability.outstandingAmount, totalLiabilities),
    })),
  };
}

/**
 * Cash flow = transaction income/expense over the selected UTC calendar-day
 * range, computed with two groupBy aggregates plus one category lookup (no
 * per-row reads, no N+1). It describes cash activity only and is explicitly
 * not net worth change.
 */
export async function getCashFlowAnalyticsData(
  userId: string,
  range: AnalyticsRange
): Promise<CashFlowAnalyticsData> {
  const where: Prisma.TransactionWhereInput = {
    userId,
    type: { in: [TransactionType.INCOME, TransactionType.EXPENSE] },
    transactionDate: {
      gte: range.dateFrom,
      lt: addUtcDays(range.dateTo, 1),
    },
  };

  const [totals, grouped] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['type'],
      where,
      _sum: { amount: true },
      _count: true,
    }),
    prisma.transaction.groupBy({
      by: ['categoryId', 'type'],
      where,
      _sum: { amount: true },
    }),
  ]);

  let income = ZERO;
  let expenses = ZERO;
  let transactionCount = 0;

  for (const row of totals) {
    transactionCount += row._count;
    if (row.type === TransactionType.INCOME) {
      income = row._sum.amount ?? ZERO;
    } else {
      expenses = row._sum.amount ?? ZERO;
    }
  }

  const categoryIds = grouped.map((row) => row.categoryId);
  const categories =
    categoryIds.length === 0
      ? []
      : await prisma.category.findMany({
          where: {
            id: { in: categoryIds },
            OR: [{ userId }, { userId: null }],
          },
          select: { id: true, name: true },
        });
  const nameById = new Map(categories.map((category) => [category.id, category.name]));

  const buildBreakdown = (
    type: TransactionType,
    denominator: Prisma.Decimal
  ) =>
    grouped
      .filter(
        (row) =>
          row.type === type &&
          row._sum.amount !== null &&
          nameById.has(row.categoryId)
      )
      .map((row) => ({
        categoryId: row.categoryId,
        name: nameById.get(row.categoryId) as string,
        amount: row._sum.amount ?? ZERO,
      }))
      .sort((a, b) => {
        const cmp = b.amount.comparedTo(a.amount);
        if (cmp !== 0) {
          return cmp;
        }
        return a.name.localeCompare(b.name);
      })
      .map((row) => ({
        categoryId: row.categoryId,
        name: row.name,
        total: roundMoney(row.amount),
        percentage: shareOf(row.amount, denominator),
      }));

  return {
    range: toRangeData(range),
    income: roundMoney(income),
    expenses: roundMoney(expenses),
    net: roundMoney(income.minus(expenses)),
    transactionCount,
    incomeByCategory: buildBreakdown(TransactionType.INCOME, income),
    expenseByCategory: buildBreakdown(TransactionType.EXPENSE, expenses),
  };
}
