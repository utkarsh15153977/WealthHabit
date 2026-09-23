import { TransactionType, CategoryType } from '@prisma/client';

export interface TransactionCategorySummary {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}

export interface TransactionData {
  id: string;
  categoryId: string;
  type: TransactionType;
  amount: number;
  description: string | null;
  transactionDate: Date;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  category: TransactionCategorySummary;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TransactionListData {
  transactions: TransactionData[];
  pagination: PaginationMeta;
}
