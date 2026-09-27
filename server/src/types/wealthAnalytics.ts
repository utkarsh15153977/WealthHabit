import { GoalStatus } from '@prisma/client';

export interface AnalyticsRangeData {
  dateFrom: string;
  dateTo: string;
  timezone: 'UTC';
}

export interface CurrentPositionData {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  assetCount: number;
  liabilityCount: number;
}

export interface GoalBreakdownItem {
  goalId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  progressPercent: number;
  targetDate: Date;
  status: GoalStatus;
}

export interface GoalsAnalyticsData {
  goalCount: number;
  activeCount: number;
  completedCount: number;
  totalTargetAmount: number;
  totalSavedAmount: number;
  progressPercent: number;
  items: GoalBreakdownItem[];
}

export interface AnalyticsSummaryData {
  current: CurrentPositionData;
  goals: GoalsAnalyticsData;
}

export interface NetWorthHistoryPoint {
  snapshotDate: Date;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

/**
 * "Net Worth Change" between the earliest and latest snapshot in range.
 * `absolute` and `percentage` are null when fewer than two snapshots exist,
 * and `percentage` is additionally null when the earliest net worth is not a
 * positive base (zero or negative denominators make it meaningless).
 */
export interface NetWorthChangeData {
  absolute: number | null;
  percentage: number | null;
}

export interface NetWorthAnalyticsData {
  range: AnalyticsRangeData;
  history: NetWorthHistoryPoint[];
  change: NetWorthChangeData;
}

export interface AssetAllocationGroup {
  type: string;
  totalValue: number;
  percentage: number;
}

export interface AssetAllocationRow {
  id: string;
  name: string;
  type: string;
  currentValue: number;
  percentage: number;
}

export interface AssetAnalyticsData {
  totalAssets: number;
  assetCount: number;
  byType: AssetAllocationGroup[];
  assets: AssetAllocationRow[];
}

export interface LiabilityCompositionGroup {
  type: string;
  totalBalance: number;
  percentage: number;
}

export interface LiabilityCompositionRow {
  id: string;
  name: string;
  type: string;
  outstandingBalance: number;
  percentage: number;
}

export interface LiabilityAnalyticsData {
  totalLiabilities: number;
  liabilityCount: number;
  byType: LiabilityCompositionGroup[];
  liabilities: LiabilityCompositionRow[];
}

export interface CashFlowCategory {
  categoryId: string;
  name: string;
  total: number;
  percentage: number;
}

/**
 * Cash flow is transaction activity over the selected range. It is NOT net
 * worth change: income minus expenses says nothing about assets or liabilities.
 */
export interface CashFlowAnalyticsData {
  range: AnalyticsRangeData;
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
  incomeByCategory: CashFlowCategory[];
  expenseByCategory: CashFlowCategory[];
}
