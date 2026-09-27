export interface ReportRangeParams {
  dateFrom?: string;
  dateTo?: string;
}

export type ReportRangeOption = '30d' | '90d' | '6m' | '12m';

export interface ReportPeriod {
  dateFrom: string;
  dateTo: string;
  timezone: 'UTC';
}

/**
 * Income/expenses/netCashFlow are transaction activity for the selected range.
 * Asset, liability and goal figures are the current position. Net cash flow is
 * never presented as a change in net worth.
 */
export interface ReportOverview {
  income: number;
  expenses: number;
  netCashFlow: number;
  transactionCount: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  activeGoalCount: number;
  completedGoalCount: number;
  totalGoalTarget: number;
  totalGoalSaved: number;
  goalProgressPercent: number;
}

export interface ReportCategoryRow {
  categoryId: string;
  name: string;
  total: number;
  percentage: number;
}

export interface ReportAssetGroup {
  type: string;
  totalValue: number;
  percentage: number;
}

export interface ReportAssetRow {
  id: string;
  name: string;
  type: string;
  currentValue: number;
  percentage: number;
}

export interface ReportAssets {
  totalAssets: number;
  assetCount: number;
  byType: ReportAssetGroup[];
  assets: ReportAssetRow[];
}

export interface ReportLiabilityGroup {
  type: string;
  totalBalance: number;
  percentage: number;
}

export interface ReportLiabilityRow {
  id: string;
  name: string;
  type: string;
  outstandingBalance: number;
  percentage: number;
}

export interface ReportLiabilities {
  totalLiabilities: number;
  liabilityCount: number;
  byType: ReportLiabilityGroup[];
  liabilities: ReportLiabilityRow[];
}

export interface ReportNetWorthPoint {
  snapshotDate: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

export type ReportGoalStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'CANCELLED';

export interface ReportGoalItem {
  goalId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  progressPercent: number;
  targetDate: string;
  status: ReportGoalStatus;
}

export interface ReportGoals {
  goalCount: number;
  activeCount: number;
  completedCount: number;
  totalTargetAmount: number;
  totalSavedAmount: number;
  progressPercent: number;
  items: ReportGoalItem[];
}

export interface FinancialReport {
  period: ReportPeriod;
  overview: ReportOverview;
  incomeCategories: ReportCategoryRow[];
  expenseCategories: ReportCategoryRow[];
  assets: ReportAssets;
  liabilities: ReportLiabilities;
  netWorthHistory: ReportNetWorthPoint[];
  goals: ReportGoals;
}

export interface ReportDownload {
  blob: Blob;
  fileName: string;
}
