export type CategoryType = 'INCOME' | 'EXPENSE';
export type TransactionType = 'INCOME' | 'EXPENSE';
export type RecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurringCategorySummary {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}

export interface RecurringTransaction {
  id: string;
  name: string;
  categoryId: string;
  type: TransactionType;
  amount: number;
  frequency: RecurringFrequency;
  startDate: string;
  endDate: string | null;
  nextOccurrenceDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category: RecurringCategorySummary;
}

export interface RecurringTransactionListResponse {
  recurringTransactions: RecurringTransaction[];
}

export interface RecurringTransactionResponse {
  recurringTransaction: RecurringTransaction;
}

export interface GenerateOccurrencesResponse {
  occurrencesCreated: number;
  nextOccurrenceDate: string;
}

export interface CreateRecurringTransactionRequest {
  name: string;
  categoryId: string;
  type: TransactionType;
  amount: string;
  frequency: RecurringFrequency;
  startDate: string;
  endDate?: string;
  isActive?: boolean;
}

export interface UpdateRecurringTransactionRequest {
  name?: string;
  categoryId?: string;
  type?: TransactionType;
  amount?: string;
  frequency?: RecurringFrequency;
  startDate?: string;
  endDate?: string | null;
  isActive?: boolean;
}
