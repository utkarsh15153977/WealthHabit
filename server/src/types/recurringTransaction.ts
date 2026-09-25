import { TransactionType, Frequency } from '@prisma/client';
import { TransactionCategorySummary } from './transaction.js';

export interface RecurringTransactionData {
  id: string;
  name: string;
  categoryId: string;
  type: TransactionType;
  amount: number;
  frequency: Frequency;
  startDate: Date;
  endDate: Date | null;
  nextOccurrenceDate: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  category: TransactionCategorySummary;
}

export interface RecurringTransactionListData {
  recurringTransactions: RecurringTransactionData[];
}

export interface GenerateOccurrencesData {
  occurrencesCreated: number;
  nextOccurrenceDate: Date;
}

export interface GenerateAllOccurrencesData {
  rulesProcessed: number;
  occurrencesCreated: number;
}
