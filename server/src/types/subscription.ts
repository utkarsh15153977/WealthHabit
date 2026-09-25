import { Frequency, SubscriptionStatus } from '@prisma/client';
import { TransactionCategorySummary } from './transaction.js';
import { ObligationDueState } from '../utils/dueState.js';

export interface SubscriptionData {
  id: string;
  name: string;
  categoryId: string | null;
  category: TransactionCategorySummary | null;
  amount: number;
  billingCycle: Frequency;
  nextRenewalDate: Date;
  status: SubscriptionStatus;
  dueState: ObligationDueState;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionListData {
  subscriptions: SubscriptionData[];
}

export interface SubscriptionResponse {
  subscription: SubscriptionData;
}
