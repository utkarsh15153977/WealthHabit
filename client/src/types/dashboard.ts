import type { Transaction } from './transaction';

export interface DashboardPeriod {
  month: string;
  start: string;
  end: string;
  timezone: string;
}

export interface DashboardSummary {
  income: number;
  expenses: number;
  savings: number;
  savingsRate: number;
}

export interface DashboardTargets {
  monthlyIncomeTarget: number | null;
  monthlySavingsTarget: number | null;
}

export interface DashboardTrendPoint {
  month: string;
  income: number;
  expenses: number;
}

export interface DashboardSpendingCategory {
  categoryId: string;
  name: string;
  type: 'EXPENSE';
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  amount: number;
  percentage: number;
}

export interface DashboardSummaryData {
  period: DashboardPeriod;
  currency: string;
  summary: DashboardSummary;
  monthlySummary: {
    month: string;
    income: number;
    expenses: number;
    savings: number;
    transactionCount: number;
    incomeTarget: number | null;
    savingsTarget: number | null;
  };
  targets: DashboardTargets;
  recentTransactions: Transaction[];
  incomeExpenseTrend: DashboardTrendPoint[];
  spendingByCategory: DashboardSpendingCategory[];
}

export interface DashboardSummaryParams {
  month?: string;
  trendMonths?: number;
  recentLimit?: number;
  categoryLimit?: number;
}
