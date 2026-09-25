import type { CategoryType } from '@prisma/client';

export interface BudgetCategorySummary {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}

export interface BudgetData {
  id: string;
  userId: string;
  name: string;
  amount: number;
  month: string;
  category: BudgetCategorySummary | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetProgressData {
  budgetAmount: number;
  spent: number;
  remaining: number;
  percentageUsed: number;
  transactionCount: number;
  periodStart: string;
  periodEnd: string;
  category: BudgetCategorySummary | null;
}

export interface BudgetDataWithProgress extends BudgetData {
  progress: BudgetProgressData;
}

export interface BudgetListData {
  budgets: BudgetDataWithProgress[];
}
