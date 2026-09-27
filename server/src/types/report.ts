import type {
  AssetAnalyticsData,
  GoalsAnalyticsData,
  LiabilityAnalyticsData,
  NetWorthHistoryPoint,
} from './wealthAnalytics.js';

/**
 * A Financial Report is a read-only projection over the authoritative Phase
 * 5A-5D records. It introduces no table, no migration and no persisted
 * "report" entity: the object below is assembled on demand, rendered as JSON,
 * CSV or PDF from the exact same values, and discarded.
 */

export interface ReportPeriodData {
  dateFrom: string;
  dateTo: string;
  timezone: 'UTC';
}

/**
 * Cash-flow figures (income / expenses / netCashFlow) describe transaction
 * activity in the selected range. Asset, liability and net-worth figures are
 * the current position. The two are deliberately kept apart — net cash flow
 * is never presented as a net worth change.
 */
export interface ReportOverviewData {
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

export interface FinancialReportData {
  period: ReportPeriodData;
  overview: ReportOverviewData;
  incomeCategories: ReportCategoryRow[];
  expenseCategories: ReportCategoryRow[];
  assets: AssetAnalyticsData;
  liabilities: LiabilityAnalyticsData;
  netWorthHistory: NetWorthHistoryPoint[];
  goals: GoalsAnalyticsData;
}
