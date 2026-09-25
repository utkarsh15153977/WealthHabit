export type CategoryType = 'INCOME' | 'EXPENSE';
export type SubscriptionCycle = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED';
export type ObligationDueState = 'UPCOMING' | 'DUE' | 'OVERDUE' | null;

export interface SubscriptionCategorySummary {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}

export interface Subscription {
  id: string;
  name: string;
  categoryId: string | null;
  category: SubscriptionCategorySummary | null;
  amount: number;
  billingCycle: SubscriptionCycle;
  nextRenewalDate: string;
  status: SubscriptionStatus;
  dueState: ObligationDueState;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionListResponse {
  subscriptions: Subscription[];
}

export interface SubscriptionResponse {
  subscription: Subscription;
}

export interface CreateSubscriptionRequest {
  name: string;
  categoryId?: string | null;
  amount: string;
  billingCycle: SubscriptionCycle;
  nextRenewalDate: string;
  status?: SubscriptionStatus;
}

export interface UpdateSubscriptionRequest {
  name?: string;
  categoryId?: string | null;
  amount?: string;
  billingCycle?: SubscriptionCycle;
  nextRenewalDate?: string;
  status?: SubscriptionStatus;
}

export interface SubscriptionListParams {
  status?: SubscriptionStatus;
  month?: string;
  active?: boolean;
}
