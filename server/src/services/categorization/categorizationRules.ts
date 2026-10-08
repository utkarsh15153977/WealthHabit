import { TransactionType } from '@prisma/client';

export interface CategorizationRuleDefinition {
  /** Normalized (or, for channels, upper-case) match key. */
  key: string;
  income: string | null;
  expense: string | null;
}

/**
 * Built-in merchant rules. Keyed by normalized merchant phrase; the phrase must
 * match on token boundaries of the normalized merchant. Entries carry a
 * category name per transaction type and are skipped when they have no entry
 * for the type being categorized.
 */
export const MERCHANT_CATEGORIZATION_RULES: CategorizationRuleDefinition[] = [
  { key: 'swiggy', income: null, expense: 'Food' },
  { key: 'zomato', income: null, expense: 'Food' },
  { key: 'bigbasket', income: null, expense: 'Food' },
  { key: 'blinkit', income: null, expense: 'Food' },
  { key: 'zepto', income: null, expense: 'Food' },
  { key: 'reliance fresh', income: null, expense: 'Food' },
  { key: 'grocery', income: null, expense: 'Food' },
  { key: 'amazon', income: null, expense: 'Shopping' },
  { key: 'flipkart', income: null, expense: 'Shopping' },
  { key: 'myntra', income: null, expense: 'Shopping' },
  { key: 'uber', income: null, expense: 'Transportation' },
  { key: 'ola', income: null, expense: 'Transportation' },
  { key: 'rapido', income: null, expense: 'Transportation' },
  { key: 'mseb', income: null, expense: 'Utilities' },
  { key: 'electricity', income: null, expense: 'Utilities' },
  { key: 'power', income: null, expense: 'Utilities' },
  { key: 'airtel', income: null, expense: 'Utilities' },
  { key: 'jio', income: null, expense: 'Utilities' },
  { key: 'netflix', income: null, expense: 'Entertainment' },
  { key: 'spotify', income: null, expense: 'Entertainment' },
  { key: 'prime video', income: null, expense: 'Entertainment' },
  { key: 'hotstar', income: null, expense: 'Entertainment' },
  { key: 'disney', income: null, expense: 'Entertainment' },
  { key: 'hp petrol', income: null, expense: 'Transportation' },
  { key: 'petrol', income: null, expense: 'Transportation' },
  { key: 'fuel', income: null, expense: 'Transportation' },
  { key: 'indian oil', income: null, expense: 'Transportation' },
  { key: 'bharat petroleum', income: null, expense: 'Transportation' },
  { key: 'acme corp', income: 'Salary', expense: 'Other Expense' },
  { key: 'salary', income: 'Salary', expense: 'Other Expense' },
  { key: 'payroll', income: 'Salary', expense: 'Other Expense' },
];

/**
 * Description phrases used when neither a user rule nor a merchant rule
 * matches (e.g. a row with no merchant but "Electricity bill payment").
 */
export const DESCRIPTION_CATEGORIZATION_RULES: CategorizationRuleDefinition[] = [
  { key: 'electricity bill', income: null, expense: 'Utilities' },
  { key: 'power bill', income: null, expense: 'Utilities' },
  { key: 'monthly salary', income: 'Salary', expense: null },
  { key: 'payroll', income: 'Salary', expense: null },
];

/**
 * Payment channel/method hints - deliberately weak. A wallet or rail
 * (GOOGLEPAY, PHONEPE, UPI, CARD, BANK_TRANSFER) carries no category
 * information, so it has no rule; only signals that are themselves the
 * transaction context (an ATM withdrawal) are mapped, and only to generic
 * categories. Matching is exact on the upper-cased channel/method token.
 */
export const PAYMENT_CHANNEL_CATEGORIZATION_RULES: CategorizationRuleDefinition[] = [
  { key: 'ATM', income: null, expense: 'Other Expense' },
  { key: 'CASH_WITHDRAWAL', income: null, expense: 'Other Expense' },
];

export function ruleCategoryForType(
  rule: CategorizationRuleDefinition,
  type: TransactionType
): string | null {
  return type === TransactionType.INCOME ? rule.income : rule.expense;
}
