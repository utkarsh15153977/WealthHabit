import type { CategorizationReason } from '../types/financial';

/**
 * Backend confidence is a deterministic heuristic, not a calibrated
 * probability, so it is mapped to plain language rather than percentages.
 */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.95) return 'High confidence';
  if (confidence >= 0.75) return 'Medium confidence';
  return 'Suggested';
}

const REASON_LABELS: Record<CategorizationReason, string> = {
  MANUAL: 'Your manual choice',
  USER_RULE: 'Based on your merchant rule',
  MERCHANT_RULE: 'Matched merchant',
  PAYMENT_CHANNEL_RULE: 'Payment channel',
  DESCRIPTION_RULE: 'Matched description',
  EXISTING_CATEGORY: 'Current category',
  DEFAULT_CATEGORY: 'Default category',
};

export function reasonLabel(reason: CategorizationReason): string {
  return REASON_LABELS[reason] ?? 'Suggested';
}
