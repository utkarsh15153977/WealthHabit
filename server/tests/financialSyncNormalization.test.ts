import { describe, it, expect } from 'vitest';
import { CategoryType, TransactionType } from '@prisma/client';
import {
  normalizeExternalTransaction,
  resolveCategoryName,
  resolveCategoryId,
  generateDedupKey,
} from '../src/services/prismaFinancialSyncService.js';
import type { ExternalTransaction } from '../src/providers/financialData/types.js';

function external(overrides: Partial<ExternalTransaction> = {}): ExternalTransaction {
  return {
    externalTransactionId: 'mock-hdfc-sav-001:2026-10-03:txn-001',
    amount: '850.00',
    type: TransactionType.EXPENSE,
    transactionDate: new Date('2026-10-03T00:00:00.000Z'),
    description: 'UPI payment - Swiggy',
    merchant: 'Swiggy',
    paymentMethod: 'UPI',
    paymentChannel: 'PHONEPE',
    externalAccountId: 'mock-hdfc-sav-001',
    ...overrides,
  };
}

const categoriesByName = new Map<string, { id: string; name: string; type: CategoryType }>([
  ['food', { id: 'cat-food', name: 'Food', type: CategoryType.EXPENSE }],
  ['shopping', { id: 'cat-shopping', name: 'Shopping', type: CategoryType.EXPENSE }],
  ['transportation', { id: 'cat-transport', name: 'Transportation', type: CategoryType.EXPENSE }],
  ['salary', { id: 'cat-salary', name: 'Salary', type: CategoryType.INCOME }],
  ['other expense', { id: 'cat-other-expense', name: 'Other Expense', type: CategoryType.EXPENSE }],
  ['other income', { id: 'cat-other-income', name: 'Other Income', type: CategoryType.INCOME }],
]);

describe('financial sync normalization helpers', () => {
  it('normalizes a valid external transaction', () => {
    const normalized = normalizeExternalTransaction(external(), 'user-1', 'acc-1');
    expect(normalized).not.toBeNull();
    expect(normalized!.amount.toNumber()).toBe(850);
    expect(normalized!.type).toBe(TransactionType.EXPENSE);
    expect(normalized!.merchant).toBe('Swiggy');
    expect(normalized!.paymentMethod).toBe('UPI');
    expect(normalized!.paymentChannel).toBe('PHONEPE');
    expect(normalized!.description).toBe('UPI payment - Swiggy');
    expect(normalized!.externalTransactionId).toBe('mock-hdfc-sav-001:2026-10-03:txn-001');
  });

  it('rejects non-positive or unparseable amounts', () => {
    expect(normalizeExternalTransaction(external({ amount: '0.00' }), 'u', 'a')).toBeNull();
    expect(normalizeExternalTransaction(external({ amount: '-10.00' }), 'u', 'a')).toBeNull();
    expect(normalizeExternalTransaction(external({ amount: 'abc' }), 'u', 'a')).toBeNull();
  });

  it('rejects invalid dates', () => {
    expect(
      normalizeExternalTransaction(external({ transactionDate: new Date('not-a-date') }), 'u', 'a')
    ).toBeNull();
  });

  it('sets dedupKey only when externalTransactionId is null', () => {
    const withExternalId = normalizeExternalTransaction(external(), 'user-1', 'acc-1');
    expect(withExternalId!.externalTransactionId).not.toBeNull();
    expect(withExternalId!.dedupKey).toBeNull();

    const withoutExternalId = normalizeExternalTransaction(
      external({ externalTransactionId: null }),
      'user-1',
      'acc-1'
    );
    expect(withoutExternalId!.dedupKey).not.toBeNull();
    expect(withoutExternalId!.dedupKey).toHaveLength(64);
  });

  it('dedupKey is deterministic and varies by each component', () => {
    const date = new Date('2026-10-03T00:00:00.000Z');
    const base = generateDedupKey('user-1', 'acc-1', '850.00', date, 'Swiggy', TransactionType.EXPENSE);

    expect(generateDedupKey('user-1', 'acc-1', '850.00', date, 'Swiggy', TransactionType.EXPENSE)).toBe(base);
    expect(generateDedupKey('user-2', 'acc-1', '850.00', date, 'Swiggy', TransactionType.EXPENSE)).not.toBe(base);
    expect(generateDedupKey('user-1', 'acc-2', '850.00', date, 'Swiggy', TransactionType.EXPENSE)).not.toBe(base);
    expect(generateDedupKey('user-1', 'acc-1', '851.00', date, 'Swiggy', TransactionType.EXPENSE)).not.toBe(base);
    expect(
      generateDedupKey('user-1', 'acc-1', '850.00', new Date('2026-10-04T00:00:00.000Z'), 'Swiggy', TransactionType.EXPENSE)
    ).not.toBe(base);
    expect(generateDedupKey('user-1', 'acc-1', '850.00', date, 'Zomato', TransactionType.EXPENSE)).not.toBe(base);
    expect(
      generateDedupKey('user-1', 'acc-1', '850.00', date, 'Swiggy', TransactionType.INCOME)
    ).not.toBe(base);
  });

  it('truncates description and paymentMethod to the existing limits', () => {
    const normalized = normalizeExternalTransaction(
      external({
        description: 'x'.repeat(600),
        paymentMethod: 'y'.repeat(150),
      }),
      'u',
      'a'
    );
    expect(normalized!.description).toHaveLength(500);
    expect(normalized!.paymentMethod).toHaveLength(100);
  });

  it('resolves merchant rules to category names', () => {
    expect(resolveCategoryName('Swiggy', TransactionType.EXPENSE)).toBe('Food');
    expect(resolveCategoryName('Amazon', TransactionType.EXPENSE)).toBe('Shopping');
    expect(resolveCategoryName('Uber', TransactionType.EXPENSE)).toBe('Transportation');
    expect(resolveCategoryName('MSEB', TransactionType.EXPENSE)).toBe('Utilities');
    expect(resolveCategoryName('Netflix', TransactionType.EXPENSE)).toBe('Entertainment');
    expect(resolveCategoryName('HP Petrol Pump', TransactionType.EXPENSE)).toBe('Transportation');
    expect(resolveCategoryName('BigBasket', TransactionType.EXPENSE)).toBe('Food');
    expect(resolveCategoryName('Acme Corp', TransactionType.INCOME)).toBe('Salary');
    expect(resolveCategoryName('Some Shop', TransactionType.EXPENSE)).toBe('Other Expense');
    expect(resolveCategoryName(null, TransactionType.INCOME)).toBe('Other Income');
  });

  it('resolves category ids honoring the transaction type', () => {
    const food = resolveCategoryId(
      normalizeExternalTransaction(external({ merchant: 'Swiggy' }), 'u', 'a')!,
      categoriesByName
    );
    expect(food).toBe('cat-food');

    const shopping = resolveCategoryId(
      normalizeExternalTransaction(external({ merchant: 'Amazon' }), 'u', 'a')!,
      categoriesByName
    );
    expect(shopping).toBe('cat-shopping');

    const salary = resolveCategoryId(
      normalizeExternalTransaction(
        external({ merchant: 'Acme Corp', type: TransactionType.INCOME, amount: '100.00' }),
        'u',
        'a'
      )!,
      categoriesByName
    );
    expect(salary).toBe('cat-salary');
  });

  it('falls back to Other Expense / Other Income for unknown merchants', () => {
    const unknownExpense = resolveCategoryId(
      normalizeExternalTransaction(external({ merchant: 'Unknown Merchant' }), 'u', 'a')!,
      categoriesByName
    );
    expect(unknownExpense).toBe('cat-other-expense');

    const unknownIncome = resolveCategoryId(
      normalizeExternalTransaction(
        external({ merchant: 'Mystery Payer', type: TransactionType.INCOME }),
        'u',
        'a'
      )!,
      categoriesByName
    );
    expect(unknownIncome).toBe('cat-other-income');
  });

  it('never resolves an income transaction to an expense category', () => {
    const incomeFromExpenseRuleMerchant = normalizeExternalTransaction(
      external({ merchant: 'Acme Corp', type: TransactionType.INCOME }),
      'u',
      'a'
    )!;
    const categoryId = resolveCategoryId(incomeFromExpenseRuleMerchant, categoriesByName);
    const category = [...categoriesByName.values()].find((c) => c.id === categoryId);
    expect(category?.type).toBe(CategoryType.INCOME);
  });
});
