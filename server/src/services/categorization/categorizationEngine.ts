import { TransactionType } from '@prisma/client';
import {
  matchesPhrase,
  normalizeChannelToken,
  normalizeDescription,
  normalizeMerchant,
} from './merchantNormalizer.js';
import {
  DESCRIPTION_CATEGORIZATION_RULES,
  MERCHANT_CATEGORIZATION_RULES,
  PAYMENT_CHANNEL_CATEGORIZATION_RULES,
  CategorizationRuleDefinition,
  ruleCategoryForType,
} from './categorizationRules.js';
import {
  CATEGORIZATION_CONFIDENCE,
  CategorizationCategory,
  CategorizationContext,
  CategorizationInput,
  CategorizationReason,
  CategorizationResult,
} from './types.js';

function sameType(left: CategorizationCategory['type'], right: CategorizationCategory['type']): boolean {
  return String(left) === String(right);
}

interface Match<T> {
  item: T;
  key: string;
  index: number;
}

/**
 * Most specific match wins: longest key first, then stable declaration order.
 * Deterministic for any input - no randomness, no tie that depends on object
 * iteration order.
 */
function orderBySpecificity<T>(matches: Match<T>[]): { item: T; key: string }[] {
  return matches
    .slice()
    .sort((a, b) => b.key.length - a.key.length || a.index - b.index)
    .map(({ item, key }) => ({ item, key }));
}

/**
 * Categorization engine: pure and deterministic. Tier precedence (first hit
 * wins, every tier validates that the resolved category exists and its type
 * equals the transaction type, otherwise the tier is skipped):
 *
 * 1. MANUAL - user-chosen category already on the row
 * 2. USER_RULE - user learned rule for the normalized merchant
 * 3. MERCHANT_RULE - built-in merchant rules
 * 4. PAYMENT_CHANNEL_RULE - weak payment channel/method hints
 * 5. DESCRIPTION_RULE - description phrases
 * 6. EXISTING_CATEGORY - unchanged category already on the row
 * 7. DEFAULT_CATEGORY - "Other Income" / "Other Expense"
 *
 * Returns null only when the category set has no usable default for the type.
 */
export function categorize(
  context: CategorizationContext,
  input: CategorizationInput
): CategorizationResult | null {
  const categories = context.categories ?? [];
  const byId = new Map(categories.map((category) => [category.id, category]));
  const byName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));

  const usableById = (id: string | null | undefined): CategorizationCategory | null => {
    if (!id) {
      return null;
    }
    const category = byId.get(id);
    if (!category || !sameType(category.type, input.type)) {
      return null;
    }
    return category;
  };

  const usableByName = (name: string): CategorizationCategory | null => {
    const category = byName.get(name.toLowerCase());
    if (!category || !sameType(category.type, input.type)) {
      return null;
    }
    return category;
  };

  const outcome = (
    category: CategorizationCategory,
    reason: CategorizationReason,
    matchedRule: string | null
  ): CategorizationResult => ({
    categoryId: category.id,
    confidence: CATEGORIZATION_CONFIDENCE[reason],
    reason,
    matchedRule,
  });

  // Tier 1: an explicit user choice on the existing row is never overridden.
  if (input.existingCategoryUserChosen && input.existingCategoryId) {
    const category = usableById(input.existingCategoryId);
    if (category) {
      return outcome(category, 'MANUAL', null);
    }
  }

  const normalizedMerchant = normalizeMerchant(input.merchant);

  // Tier 2: user learned rules (merchant scoped, type checked at application).
  if (normalizedMerchant && context.userRules && context.userRules.length > 0) {
    const matches: Match<(typeof context.userRules)[number]>[] = [];
    context.userRules.forEach((rule, index) => {
      if (rule.normalizedMerchant && matchesPhrase(normalizedMerchant, rule.normalizedMerchant)) {
        matches.push({ item: rule, key: rule.normalizedMerchant, index });
      }
    });
    const ordered = matches.slice().sort((a, b) => {
      const byPriority = (b.item.priority ?? 0) - (a.item.priority ?? 0);
      if (byPriority !== 0) {
        return byPriority;
      }
      const byLength = b.key.length - a.key.length;
      if (byLength !== 0) {
        return byLength;
      }
      return a.key.localeCompare(b.key);
    });
    for (const { item: rule } of ordered) {
      const category = usableById(rule.categoryId);
      if (category) {
        return outcome(category, 'USER_RULE', rule.normalizedMerchant);
      }
    }
  }

  // Tier 3: built-in merchant rules.
  if (normalizedMerchant) {
    const matches: Match<CategorizationRuleDefinition>[] = [];
    MERCHANT_CATEGORIZATION_RULES.forEach((rule, index) => {
      if (!matchesPhrase(normalizedMerchant, rule.key)) {
        return;
      }
      if (!ruleCategoryForType(rule, input.type)) {
        return;
      }
      matches.push({ item: rule, key: rule.key, index });
    });
    for (const { item: rule, key } of orderBySpecificity(matches)) {
      const categoryName = ruleCategoryForType(rule, input.type);
      if (!categoryName) {
        continue;
      }
      const category = usableByName(categoryName);
      if (category) {
        return outcome(category, 'MERCHANT_RULE', key);
      }
    }
  }

  // Tier 4: weak payment channel/method hints.
  const channelTokens = [
    normalizeChannelToken(input.paymentChannel),
    normalizeChannelToken(input.paymentMethod),
  ]
    .filter((token): token is string => token !== null)
    .map((token) => token.toUpperCase());
  for (const token of channelTokens) {
    const rule = PAYMENT_CHANNEL_CATEGORIZATION_RULES.find(
      (candidate) => candidate.key.toUpperCase() === token
    );
    if (!rule) {
      continue;
    }
    const categoryName = ruleCategoryForType(rule, input.type);
    if (!categoryName) {
      continue;
    }
    const category = usableByName(categoryName);
    if (category) {
      return outcome(category, 'PAYMENT_CHANNEL_RULE', rule.key);
    }
  }

  // Tier 5: description phrases.
  const normalizedDescription = normalizeDescription(input.description);
  if (normalizedDescription) {
    const matches: Match<CategorizationRuleDefinition>[] = [];
    DESCRIPTION_CATEGORIZATION_RULES.forEach((rule, index) => {
      if (!matchesPhrase(normalizedDescription, rule.key)) {
        return;
      }
      if (!ruleCategoryForType(rule, input.type)) {
        return;
      }
      matches.push({ item: rule, key: rule.key, index });
    });
    for (const { item: rule, key } of orderBySpecificity(matches)) {
      const categoryName = ruleCategoryForType(rule, input.type);
      if (!categoryName) {
        continue;
      }
      const category = usableByName(categoryName);
      if (category) {
        return outcome(category, 'DESCRIPTION_RULE', key);
      }
    }
  }

  // Tier 6: a category already on the row that the user did not choose.
  if (!input.existingCategoryUserChosen && input.existingCategoryId) {
    const category = usableById(input.existingCategoryId);
    if (category) {
      return outcome(category, 'EXISTING_CATEGORY', null);
    }
  }

  // Tier 7: the type default.
  const defaultName =
    input.type === TransactionType.INCOME ? 'Other Income' : 'Other Expense';
  const fallback = usableByName(defaultName);
  if (fallback) {
    return outcome(fallback, 'DEFAULT_CATEGORY', null);
  }

  return null;
}

/**
 * Name-level built-in merchant resolution used by the legacy sync helpers.
 * Never consults the category table; the caller decides what to do when the
 * name does not exist.
 */
export function resolveBuiltInCategoryName(
  merchant: string | null,
  type: TransactionType
): string {
  const normalizedMerchant = normalizeMerchant(merchant);
  if (normalizedMerchant) {
    for (const rule of MERCHANT_CATEGORIZATION_RULES) {
      if (!matchesPhrase(normalizedMerchant, rule.key)) {
        continue;
      }
      if (type === TransactionType.INCOME && rule.income) {
        return rule.income;
      }
      if (type === TransactionType.EXPENSE && rule.expense) {
        return rule.expense;
      }
    }
  }
  return type === TransactionType.INCOME ? 'Other Income' : 'Other Expense';
}
