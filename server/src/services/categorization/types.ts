import { CategoryType, TransactionType } from '@prisma/client';

export type CategorizationReason =
  | 'MANUAL'
  | 'USER_RULE'
  | 'MERCHANT_RULE'
  | 'PAYMENT_CHANNEL_RULE'
  | 'DESCRIPTION_RULE'
  | 'EXISTING_CATEGORY'
  | 'DEFAULT_CATEGORY';

/**
 * Deterministic rule-strength score per reason tier. These values describe how
 * strong the matched signal is (highest-priority tier wins, confidence only
 * reports which tier produced the answer); they are not calibrated
 * probabilities.
 */
export const CATEGORIZATION_CONFIDENCE: Record<CategorizationReason, number> = {
  MANUAL: 0.99,
  USER_RULE: 0.98,
  MERCHANT_RULE: 0.95,
  PAYMENT_CHANNEL_RULE: 0.8,
  DESCRIPTION_RULE: 0.75,
  EXISTING_CATEGORY: 0.7,
  DEFAULT_CATEGORY: 0.5,
};

export interface CategorizationCategory {
  id: string;
  name: string;
  type: CategoryType | TransactionType;
}

export interface CategorizationUserRule {
  normalizedMerchant: string;
  categoryId: string;
  priority?: number;
}

export interface CategorizationInput {
  type: TransactionType;
  merchant: string | null;
  description?: string | null;
  paymentChannel?: string | null;
  paymentMethod?: string | null;
  existingCategoryId?: string | null;
  existingCategoryUserChosen?: boolean;
}

export interface CategorizationContext {
  categories: CategorizationCategory[];
  userRules?: CategorizationUserRule[];
}

export interface CategorizationResult {
  categoryId: string;
  confidence: number;
  reason: CategorizationReason;
  matchedRule: string | null;
}
