import { TransactionType, CategoryType, TransactionSource, FinancialAccountType } from '@prisma/client';

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

export interface ImportedTransactionAccountSummary {
  id: string;
  name: string;
  mask: string | null;
  type: FinancialAccountType;
  currency: string;
  institutionName: string | null;
}

export interface ImportedTransactionData {
  id: string;
  amount: number;
  type: TransactionType;
  description: string | null;
  merchant: string | null;
  transactionDate: Date;
  paymentMethod: string | null;
  paymentChannel: string | null;
  category: TransactionCategorySummary;
  financialAccountId: string | null;
  financialAccount: ImportedTransactionAccountSummary | null;
  source: TransactionSource;
  externalTransactionId: string | null;
  importedAt: Date | null;
}

export interface ImportedTransactionListData {
  transactions: ImportedTransactionData[];
  pagination: PaginationMeta;
}
