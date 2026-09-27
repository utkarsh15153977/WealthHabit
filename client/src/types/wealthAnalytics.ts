export interface AnalyticsRange {
  dateFrom: string;
  dateTo: string;
  timezone: 'UTC';
}

export interface AnalyticsRangeParams {
  dateFrom?: string;
  dateTo?: string;
}

export type AnalyticsRangeOption = '30d' | '90d' | '6m' | '12m';

export interface CurrentPosition {
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
  targetDate: string;
  status: 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'CANCELLED';
}

export interface GoalsAnalytics {
  goalCount: number;
  activeCount: number;
  completedCount: number;
  totalTargetAmount: number;
  totalSavedAmount: number;
  progressPercent: number;
  items: GoalBreakdownItem[];
}

export interface AnalyticsSummary {
  current: CurrentPosition;
  goals: GoalsAnalytics;
}

export interface NetWorthHistoryPoint {
  snapshotDate: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

export interface NetWorthChange {
  absolute: number | null;
  percentage: number | null;
}

export interface NetWorthAnalytics {
  range: AnalyticsRange;
  history: NetWorthHistoryPoint[];
  change: NetWorthChange;
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

export interface AssetAnalytics {
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

export interface LiabilityAnalytics {
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
 * Cash flow is transaction income/expense activity for the selected range. It
 * is deliberately labelled "Cash Flow" and never presented as net worth
 * change.
 */
export interface CashFlowAnalytics {
  range: AnalyticsRange;
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
  incomeByCategory: CashFlowCategory[];
  expenseByCategory: CashFlowCategory[];
}
