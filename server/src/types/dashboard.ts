import type { TransactionData } from './transaction.js';

export interface DashboardPeriod {
  month: string;
  start: string;
  end: string;
  timezone: 'UTC';
}

export interface DashboardSummary {
  income: number;
  expenses: number;
  savings: number;
  savingsRate: number;
}

export interface DashboardMonthlySummary {
  month: string;
  income: number;
  expenses: number;
  savings: number;
  transactionCount: number;
  incomeTarget: number | null;
  savingsTarget: number | null;
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
  monthlySummary: DashboardMonthlySummary;
  targets: DashboardTargets;
  recentTransactions: TransactionData[];
  incomeExpenseTrend: DashboardTrendPoint[];
  spendingByCategory: DashboardSpendingCategory[];
}
