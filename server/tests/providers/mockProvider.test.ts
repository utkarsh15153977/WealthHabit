import { describe, it, expect, beforeEach } from 'vitest';
import {
  FinancialConnectionProvider,
  FinancialAccountType,
  TransactionType,
} from '@prisma/client';
import { MockFinancialProvider } from '../../src/providers/financialData/mockProvider.js';
import type { FinancialDataProvider } from '../../src/providers/financialData/types.js';

const WIDE_RANGE = {
  from: new Date('2026-09-01T00:00:00.000Z'),
  to: new Date('2026-10-31T00:00:00.000Z'),
};

describe('MockFinancialProvider', () => {
  let provider: FinancialDataProvider;

  beforeEach(() => {
    provider = new MockFinancialProvider();
  });

  it('reports the MOCK provider identity', () => {
    expect(provider.provider).toBe(FinancialConnectionProvider.MOCK);
  });

  it('returns a deterministic connection reference without external calls', async () => {
    await expect(
      provider.connect({ userId: 'user-123', consent: undefined })
    ).resolves.toEqual({ externalConnectionRef: 'mock-connection-user-123' });
  });

  it('disconnects without any external operation', async () => {
    await expect(provider.disconnect('mock-connection-user-123')).resolves.toBeUndefined();
  });

  it('returns the three deterministic fixture accounts', async () => {
    const accounts = await provider.getAccounts('mock-connection-user-123');

    expect(accounts.map((account) => account.externalAccountId)).toEqual([
      'mock-hdfc-sav-001',
      'mock-hdfc-debit-001',
      'mock-icici-credit-001',
    ]);
    expect(accounts.map((account) => account.name)).toEqual([
      'HDFC Savings',
      'HDFC Debit Card',
      'ICICI Credit Card',
    ]);
    expect(accounts.map((account) => account.type)).toEqual([
      FinancialAccountType.SAVINGS,
      FinancialAccountType.DEBIT_CARD,
      FinancialAccountType.CREDIT_CARD,
    ]);
    expect(accounts.map((account) => account.mask)).toEqual(['1234', '4821', '7812']);
    expect(accounts.map((account) => account.institutionName)).toEqual([
      'HDFC',
      'HDFC',
      'ICICI',
    ]);
    expect(accounts.every((account) => account.currency === 'INR')).toBe(true);
  });

  it('returns identical accounts on repeated calls', async () => {
    const first = await provider.getAccounts('mock-connection-user-123');
    const second = await provider.getAccounts('mock-connection-user-123');

    expect(second).toEqual(first);
  });

  it('returns every fixture transaction for a wide date range', async () => {
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      ...WIDE_RANGE,
    });

    expect(transactions).toHaveLength(19);
  });

  it('returns identical transactions for identical arguments', async () => {
    const first = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      ...WIDE_RANGE,
    });
    const second = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      ...WIDE_RANGE,
    });

    expect(second).toEqual(first);
  });

  it('derives stable, unique transaction IDs from account, date and sequence', async () => {
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      ...WIDE_RANGE,
    });
    const ids = transactions.map((transaction) => transaction.externalTransactionId);

    expect(ids).toContain('mock-hdfc-sav-001:2026-10-03:txn-001');
    expect(ids).toContain('mock-hdfc-debit-001:2026-10-04:txn-002');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  it('returns only transactions on a single calendar day', async () => {
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      from: new Date('2026-10-03T00:00:00.000Z'),
      to: new Date('2026-10-03T00:00:00.000Z'),
    });

    expect(transactions).toHaveLength(2);
    expect(transactions.every((transaction) => transaction.externalAccountId === 'mock-hdfc-sav-001')).toBe(true);
    expect(transactions.map((transaction) => transaction.merchant)).toEqual(['Swiggy', 'Uber']);
  });

  it('includes both boundary days of a date range', async () => {
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-03T00:00:00.000Z'),
    });

    expect(transactions).toHaveLength(5);
    expect(
      transactions.some((transaction) => transaction.externalAccountId === 'mock-icici-credit-001')
    ).toBe(true);
  });

  it('normalizes a time-of-day in the "to" bound to an inclusive calendar day', async () => {
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      from: new Date('2026-10-03T00:00:00.000Z'),
      to: new Date('2026-10-03T15:30:00.000Z'),
    });

    expect(transactions).toHaveLength(2);
    expect(
      transactions.every((transaction) => transaction.externalAccountId === 'mock-hdfc-sav-001')
    ).toBe(true);
  });

  it('returns no transactions outside the fixture window', async () => {
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-11-30T00:00:00.000Z'),
    });

    expect(transactions).toHaveLength(0);
  });

  it('returns no transactions for an inverted range', async () => {
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      from: new Date('2026-10-10T00:00:00.000Z'),
      to: new Date('2026-10-01T00:00:00.000Z'),
    });

    expect(transactions).toHaveLength(0);
  });

  it('never returns a transaction outside the requested range', async () => {
    const from = new Date('2026-09-20T00:00:00.000Z');
    const to = new Date('2026-10-05T00:00:00.000Z');
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      from,
      to,
    });
    const rangeStart = from.getTime();
    const rangeEnd = Date.UTC(2026, 9, 6);

    expect(transactions.length).toBeGreaterThan(0);
    expect(
      transactions.every((transaction) => {
        const time = transaction.transactionDate.getTime();
        return time >= rangeStart && time < rangeEnd;
      })
    ).toBe(true);
  });

  it('exposes UPI transactions through GooglePay and PhonePe channels', async () => {
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      ...WIDE_RANGE,
    });
    const upiTransactions = transactions.filter(
      (transaction) => transaction.paymentMethod === 'UPI'
    );
    const channels = new Set(
      upiTransactions.map((transaction) => transaction.paymentChannel)
    );

    expect(upiTransactions.length).toBeGreaterThanOrEqual(5);
    expect(channels.has('GOOGLEPAY')).toBe(true);
    expect(channels.has('PHONEPE')).toBe(true);
    expect(
      upiTransactions.every((transaction) => transaction.paymentChannel !== null)
    ).toBe(true);
  });

  it('includes the Swiggy UPI fixture with PhonePe attribution', async () => {
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      ...WIDE_RANGE,
    });
    const swiggy = transactions.find((transaction) => transaction.merchant === 'Swiggy');

    expect(swiggy).toMatchObject({
      externalTransactionId: 'mock-hdfc-sav-001:2026-10-03:txn-001',
      amount: '850.00',
      type: TransactionType.EXPENSE,
      description: 'UPI payment - Swiggy',
      paymentMethod: 'UPI',
      paymentChannel: 'PHONEPE',
      externalAccountId: 'mock-hdfc-sav-001',
    });
    expect(swiggy?.transactionDate.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('includes salary income and expense transactions', async () => {
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      ...WIDE_RANGE,
    });
    const income = transactions.filter(
      (transaction) => transaction.type === TransactionType.INCOME
    );
    const expenses = transactions.filter(
      (transaction) => transaction.type === TransactionType.EXPENSE
    );

    expect(income).toHaveLength(2);
    expect(income.every((transaction) => transaction.merchant === 'Acme Corp')).toBe(true);
    expect(income.every((transaction) => transaction.description === 'Salary credit')).toBe(true);
    expect(expenses).toHaveLength(17);
  });

  it('returns positive decimal string amounts only', async () => {
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      ...WIDE_RANGE,
    });

    expect(
      transactions.every(
        (transaction) => /^\d+\.\d{2}$/.test(transaction.amount) && Number(transaction.amount) > 0
      )
    ).toBe(true);
  });

  it('never returns credentials, secrets or long digit runs', async () => {
    const accounts = await provider.getAccounts('mock-connection-user-123');
    const transactions = await provider.getTransactions({
      connectionId: 'mock-connection-user-123',
      ...WIDE_RANGE,
    });
    const payload = JSON.stringify({ accounts, transactions }).toLowerCase();

    for (const token of ['password', 'otp', 'pin', 'cvv', 'cvc', 'pan', 'secret', 'token']) {
      expect(payload).not.toContain(token);
    }
    expect(payload).not.toMatch(/\d{12,}/);
  });
});
