import type { CategoryType } from './category';

export type TransactionType = 'INCOME' | 'EXPENSE';

export interface TransactionCategory {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}

export interface Transaction {
  id: string;
  categoryId: string;
  type: TransactionType;
  amount: number;
  description: string | null;
  transactionDate: string;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  category: TransactionCategory;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TransactionListResponse {
  transactions: Transaction[];
  pagination: Pagination;
}

export interface TransactionResponse {
  transaction: Transaction;
}

export interface TransactionListParams {
  type?: TransactionType;
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateTransactionRequest {
  categoryId: string;
  type: TransactionType;
  amount: string;
  transactionDate: string;
  description?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
}

export interface UpdateTransactionRequest {
  categoryId?: string;
  type?: TransactionType;
  amount?: string;
  transactionDate?: string;
  description?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
}
