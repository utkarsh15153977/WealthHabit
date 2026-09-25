import { BillStatus, Frequency } from '@prisma/client';
import { TransactionCategorySummary } from './transaction.js';
import { ObligationDueState } from '../utils/dueState.js';

export interface BillData {
  id: string;
  name: string;
  categoryId: string | null;
  category: TransactionCategorySummary | null;
  amount: number;
  frequency: Frequency;
  dueDate: Date;
  nextDueDate: Date;
  status: BillStatus;
  dueState: ObligationDueState;
  autoPay: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillListData {
  bills: BillData[];
}

export interface BillResponse {
  bill: BillData;
}
