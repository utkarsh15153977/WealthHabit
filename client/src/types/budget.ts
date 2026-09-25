export type CategoryType = 'INCOME' | 'EXPENSE';

export interface BudgetCategorySummary {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}

export interface Budget {
  id: string;
  userId: string;
  name: string;
  amount: number;
  month: string;
  category: BudgetCategorySummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetProgress {
  budgetAmount: number;
  spent: number;
  remaining: number;
  percentageUsed: number;
  transactionCount: number;
  periodStart: string;
  periodEnd: string;
  category: BudgetCategorySummary | null;
}

export interface BudgetWithProgress extends Budget {
  progress: BudgetProgress;
}

export interface BudgetListResponse {
  budgets: BudgetWithProgress[];
}

export interface BudgetResponse {
  budget: Budget;
}

export interface BudgetWithProgressResponse {
  budget: BudgetWithProgress;
}

export interface BudgetProgressResponse {
  progress: BudgetProgress;
}

export interface CreateBudgetRequest {
  name: string;
  amount: string;
  month: string;
  categoryId?: string | null;
}

export interface UpdateBudgetRequest {
  name?: string;
  amount?: string;
  month?: string;
  categoryId?: string | null;
}

export interface BudgetListParams {
  month?: string;
}
