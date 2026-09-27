import type { AnalyticsRange } from '../schemas/reportSchemas.js';
import {
  getAnalyticsSummaryData,
  getAssetAnalyticsData,
  getCashFlowAnalyticsData,
  getLiabilityAnalyticsData,
  getNetWorthAnalyticsData,
} from './prismaWealthAnalyticsService.js';
import type {
  FinancialReportData,
  ReportCategoryRow,
  ReportOverviewData,
} from '../types/report.js';

/**
 * The single source of every number the report layer shows.
 *
 * `buildFinancialReportData` performs no arithmetic of its own: every figure
 * is delegated to the existing Phase 5D Wealth Analytics domain functions,
 * which in turn read the Phase 5A-5C sources of truth. That guarantees the
 * JSON preview, the CSV export and the PDF export can never disagree, and it
 * guarantees a report can never contradict the analytics the user already
 * sees elsewhere in the app.
 *
 * Read-only by construction: nothing here writes to the database — no
 * snapshot, no notification, no mutation of any financial row.
 *
 * Queries are flat aggregates run concurrently (2 groupBys + lookups for cash
 * flow, groupBy/aggregate pairs for assets and liabilities, one snapshot
 * read, one goals plan). There is no per-row query, so no N+1.
 */
export async function buildFinancialReportData(
  userId: string,
  range: AnalyticsRange
): Promise<FinancialReportData> {
  const [summary, cashFlow, assets, liabilities, netWorth] = await Promise.all([
    getAnalyticsSummaryData(userId),
    getCashFlowAnalyticsData(userId, range),
    getAssetAnalyticsData(userId),
    getLiabilityAnalyticsData(userId),
    getNetWorthAnalyticsData(userId, range),
  ]);

  const overview: ReportOverviewData = {
    income: cashFlow.income,
    expenses: cashFlow.expenses,
    netCashFlow: cashFlow.net,
    transactionCount: cashFlow.transactionCount,
    totalAssets: summary.current.totalAssets,
    totalLiabilities: summary.current.totalLiabilities,
    netWorth: summary.current.netWorth,
    activeGoalCount: summary.goals.activeCount,
    completedGoalCount: summary.goals.completedCount,
    totalGoalTarget: summary.goals.totalTargetAmount,
    totalGoalSaved: summary.goals.totalSavedAmount,
    goalProgressPercent: summary.goals.progressPercent,
  };

  const incomeCategories: ReportCategoryRow[] = cashFlow.incomeByCategory.map(
    (category) => ({
      categoryId: category.categoryId,
      name: category.name,
      total: category.total,
      percentage: category.percentage,
    })
  );

  const expenseCategories: ReportCategoryRow[] = cashFlow.expenseByCategory.map(
    (category) => ({
      categoryId: category.categoryId,
      name: category.name,
      total: category.total,
      percentage: category.percentage,
    })
  );

  return {
    period: cashFlow.range,
    overview,
    incomeCategories,
    expenseCategories,
    assets,
    liabilities,
    netWorthHistory: netWorth.history,
    goals: summary.goals,
  };
}
