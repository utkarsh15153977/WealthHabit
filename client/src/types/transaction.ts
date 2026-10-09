import type { CategoryType } from './category';

export type TransactionType = 'INCOME' | 'EXPENSE';

export type TransactionSource = 'MANUAL' | 'IMPORTED';

export interface TransactionCategory {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}

export interface TransactionAccountSummary {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  currency: string;
  institutionName: string | null;
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
  /**
   * Financial-import metadata. `GET /api/transactions` (and the dashboard
   * summary) emits these for every row since Phase 6I: `source` is `MANUAL` or
   * `IMPORTED`, while `merchant`, `paymentChannel`, `financialAccountId` and
   * `financialAccount` are `null` when they do not apply. They stay optional so
   * the UI also tolerates responses that omit them, and they are rendered only
   * when present.
   */
  source?: TransactionSource;
  merchant?: string | null;
  paymentChannel?: string | null;
  financialAccountId?: string | null;
  financialAccount?: TransactionAccountSummary | null;
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
