import { describe, it, expect } from 'vitest';
import { CategoryType, TransactionType } from '@prisma/client';
import {
  categorize,
  resolveBuiltInCategoryName,
} from '../src/services/categorization/categorizationEngine.js';
import {
  CATEGORIZATION_CONFIDENCE,
  CategorizationCategory,
  CategorizationInput,
} from '../src/services/categorization/types.js';

const categories: CategorizationCategory[] = [
  { id: 'cat-food', name: 'Food', type: CategoryType.EXPENSE },
  { id: 'cat-shopping', name: 'Shopping', type: CategoryType.EXPENSE },
  { id: 'cat-transport', name: 'Transportation', type: CategoryType.EXPENSE },
  { id: 'cat-utilities', name: 'Utilities', type: CategoryType.EXPENSE },
  { id: 'cat-entertainment', name: 'Entertainment', type: CategoryType.EXPENSE },
  { id: 'cat-salary', name: 'Salary', type: CategoryType.INCOME },
  { id: 'cat-freelance', name: 'Freelance', type: CategoryType.INCOME },
  { id: 'cat-other-expense', name: 'Other Expense', type: CategoryType.EXPENSE },
  { id: 'cat-other-income', name: 'Other Income', type: CategoryType.INCOME },
];

function expenseInput(overrides: Partial<CategorizationInput> = {}): CategorizationInput {
  return { type: TransactionType.EXPENSE, merchant: null, ...overrides };
}

function incomeInput(overrides: Partial<CategorizationInput> = {}): CategorizationInput {
  return { type: TransactionType.INCOME, merchant: null, ...overrides };
}

describe('categorization engine', () => {
  it('matches built-in merchant rules and reports reason and confidence', () => {
    const result = categorize({ categories }, expenseInput({ merchant: 'Swiggy' }));
    expect(result).toEqual({
      categoryId: 'cat-food',
      confidence: CATEGORIZATION_CONFIDENCE.MERCHANT_RULE,
      reason: 'MERCHANT_RULE',
      matchedRule: 'swiggy',
    });
    expect(result!.confidence).toBe(0.95);
  });

  it('normalizes noisy provider merchant strings before matching', () => {
    const variants = [
      'SWIGGY*ORDER123',
      'Swiggy Order #123',
      'SWIGGY IN',
      'swiggy',
      'UPI payment - Swiggy',
    ];
    for (const merchant of variants) {
      const result = categorize({ categories }, expenseInput({ merchant }));
      expect(result?.categoryId).toBe('cat-food');
      expect(result?.reason).toBe('MERCHANT_RULE');
      expect(result?.matchedRule).toBe('swiggy');
    }
  });

  it('resolves every built-in fixture mapping', () => {
    const expectations: [string, string][] = [
      ['Swiggy', 'cat-food'],
      ['BigBasket', 'cat-food'],
      ['Reliance Fresh', 'cat-food'],
      ['Amazon', 'cat-shopping'],
      ['Flipkart', 'cat-shopping'],
      ['Myntra', 'cat-shopping'],
      ['Uber', 'cat-transport'],
      ['Ola', 'cat-transport'],
      ['MSEB', 'cat-utilities'],
      ['Netflix', 'cat-entertainment'],
      ['Spotify', 'cat-entertainment'],
      ['HP Petrol Pump', 'cat-transport'],
    ];
    for (const [merchant, categoryId] of expectations) {
      expect(categorize({ categories }, expenseInput({ merchant }))?.categoryId).toBe(categoryId);
    }
    expect(
      categorize({ categories }, incomeInput({ merchant: 'Acme Corp' }))?.categoryId
    ).toBe('cat-salary');
  });

  it('applies a user learned rule above built-in rules', () => {
    const result = categorize(
      { categories, userRules: [{ normalizedMerchant: 'amazon', categoryId: 'cat-food' }] },
      expenseInput({ merchant: 'Amazon' })
    );
    expect(result).toEqual({
      categoryId: 'cat-food',
      confidence: CATEGORIZATION_CONFIDENCE.USER_RULE,
      reason: 'USER_RULE',
      matchedRule: 'amazon',
    });
    expect(result!.confidence).toBe(0.98);
  });

  it('skips a user rule whose category type does not match the transaction', () => {
    const result = categorize(
      { categories, userRules: [{ normalizedMerchant: 'uber', categoryId: 'cat-salary' }] },
      expenseInput({ merchant: 'Uber' })
    );
    expect(result?.reason).toBe('MERCHANT_RULE');
    expect(result?.categoryId).toBe('cat-transport');
  });

  it('picks the highest priority user rule, then the most specific key', () => {
    const priorityWins = categorize(
      {
        categories,
        userRules: [
          { normalizedMerchant: 'amazon fresh', categoryId: 'cat-food' },
          { normalizedMerchant: 'amazon', categoryId: 'cat-shopping', priority: 10 },
        ],
      },
      expenseInput({ merchant: 'Amazon Fresh Market' })
    );
    expect(priorityWins?.matchedRule).toBe('amazon');

    const specificityWins = categorize(
      {
        categories,
        userRules: [
          { normalizedMerchant: 'amazon', categoryId: 'cat-shopping' },
          { normalizedMerchant: 'amazon fresh', categoryId: 'cat-food' },
        ],
      },
      expenseInput({ merchant: 'Amazon Fresh Market' })
    );
    expect(specificityWins?.matchedRule).toBe('amazon fresh');
    expect(specificityWins?.categoryId).toBe('cat-food');
  });

  it('treats payment channels as weak hints only', () => {
    const channelOnly = categorize(
      { categories },
      expenseInput({ paymentMethod: 'ATM' })
    );
    expect(channelOnly).toEqual({
      categoryId: 'cat-other-expense',
      confidence: CATEGORIZATION_CONFIDENCE.PAYMENT_CHANNEL_RULE,
      reason: 'PAYMENT_CHANNEL_RULE',
      matchedRule: 'ATM',
    });

    const merchantWins = categorize(
      { categories },
      expenseInput({ merchant: 'Swiggy', paymentMethod: 'ATM' })
    );
    expect(merchantWins?.reason).toBe('MERCHANT_RULE');
    expect(merchantWins?.categoryId).toBe('cat-food');
  });

  it('never infers a category from a UPI wallet channel alone', () => {
    const googlepay = categorize(
      { categories },
      expenseInput({ paymentChannel: 'GOOGLEPAY' })
    );
    expect(googlepay?.reason).toBe('DEFAULT_CATEGORY');
    expect(googlepay?.categoryId).toBe('cat-other-expense');

    const phonepe = categorize(
      { categories },
      expenseInput({ paymentChannel: 'PHONEPE', paymentMethod: 'UPI' })
    );
    expect(phonepe?.reason).toBe('DEFAULT_CATEGORY');
  });

  it('uses description phrases when there is no merchant signal', () => {
    const result = categorize(
      { categories },
      expenseInput({ description: 'Electricity bill payment' })
    );
    expect(result).toEqual({
      categoryId: 'cat-utilities',
      confidence: CATEGORIZATION_CONFIDENCE.DESCRIPTION_RULE,
      reason: 'DESCRIPTION_RULE',
      matchedRule: 'electricity bill',
    });

    const incomeSalary = categorize(
      { categories },
      incomeInput({ description: 'ACME monthly salary' })
    );
    expect(incomeSalary?.categoryId).toBe('cat-salary');
    expect(incomeSalary?.reason).toBe('DESCRIPTION_RULE');
  });

  it('lets a merchant rule beat a conflicting description', () => {
    const result = categorize(
      { categories },
      expenseInput({ merchant: 'Swiggy', description: 'Electricity bill payment' })
    );
    expect(result?.reason).toBe('MERCHANT_RULE');
    expect(result?.categoryId).toBe('cat-food');
  });

  it('keeps an explicit user choice on the row', () => {
    const manual = categorize(
      { categories },
      expenseInput({
        merchant: 'Amazon',
        existingCategoryId: 'cat-food',
        existingCategoryUserChosen: true,
      })
    );
    expect(manual).toEqual({
      categoryId: 'cat-food',
      confidence: CATEGORIZATION_CONFIDENCE.MANUAL,
      reason: 'MANUAL',
      matchedRule: null,
    });
  });

  it('keeps an untouched existing category above the default', () => {
    const existing = categorize(
      { categories },
      expenseInput({
        merchant: 'Unknown Merchant',
        existingCategoryId: 'cat-shopping',
        existingCategoryUserChosen: false,
      })
    );
    expect(existing?.reason).toBe('EXISTING_CATEGORY');
    expect(existing?.categoryId).toBe('cat-shopping');
  });

  it('falls back to the type default with lowest confidence', () => {
    const expense = categorize({ categories }, expenseInput({ merchant: 'Unknown Merchant' }));
    expect(expense).toEqual({
      categoryId: 'cat-other-expense',
      confidence: CATEGORIZATION_CONFIDENCE.DEFAULT_CATEGORY,
      reason: 'DEFAULT_CATEGORY',
      matchedRule: null,
    });

    const income = categorize({ categories }, incomeInput({ merchant: 'Mystery Payer' }));
    expect(income?.categoryId).toBe('cat-other-income');

    const expenseIncomeRule = categorize(
      { categories },
      incomeInput({ merchant: 'Swiggy' })
    );
    expect(expenseIncomeRule?.reason).toBe('DEFAULT_CATEGORY');
    expect(expenseIncomeRule?.categoryId).toBe('cat-other-income');
  });

  it('ignores an existing category whose type does not match', () => {
    const result = categorize(
      { categories },
      expenseInput({
        merchant: 'Unknown Merchant',
        existingCategoryId: 'cat-salary',
        existingCategoryUserChosen: false,
      })
    );
    expect(result?.reason).toBe('DEFAULT_CATEGORY');
    expect(result?.categoryId).toBe('cat-other-expense');
  });

  it('returns null when no usable default category exists', () => {
    const result = categorize(
      { categories: [{ id: 'cat-food', name: 'Food', type: CategoryType.EXPENSE }] },
      expenseInput({ merchant: 'Unknown Merchant' })
    );
    expect(result).toBeNull();
  });

  it('is deterministic across repeated runs', () => {
    const inputs: CategorizationInput[] = [
      expenseInput({ merchant: 'SWIGGY*ORDER123' }),
      expenseInput({ merchant: 'Amazon', paymentChannel: 'GOOGLEPAY' }),
      incomeInput({ description: 'payroll credit' }),
      expenseInput({ paymentMethod: 'ATM' }),
    ];
    for (const input of inputs) {
      const first = categorize({ categories }, input);
      for (let run = 0; run < 5; run += 1) {
        expect(categorize({ categories }, input)).toEqual(first);
      }
    }
  });

  it('exposes legacy name-level resolution unchanged', () => {
    expect(resolveBuiltInCategoryName('Swiggy', TransactionType.EXPENSE)).toBe('Food');
    expect(resolveBuiltInCategoryName('Amazon', TransactionType.EXPENSE)).toBe('Shopping');
    expect(resolveBuiltInCategoryName('Uber', TransactionType.EXPENSE)).toBe('Transportation');
    expect(resolveBuiltInCategoryName('MSEB', TransactionType.EXPENSE)).toBe('Utilities');
    expect(resolveBuiltInCategoryName('Netflix', TransactionType.EXPENSE)).toBe('Entertainment');
    expect(resolveBuiltInCategoryName('HP Petrol Pump', TransactionType.EXPENSE)).toBe(
      'Transportation'
    );
    expect(resolveBuiltInCategoryName('BigBasket', TransactionType.EXPENSE)).toBe('Food');
    expect(resolveBuiltInCategoryName('Acme Corp', TransactionType.INCOME)).toBe('Salary');
    expect(resolveBuiltInCategoryName('Some Shop', TransactionType.EXPENSE)).toBe('Other Expense');
    expect(resolveBuiltInCategoryName(null, TransactionType.INCOME)).toBe('Other Income');
  });
});
