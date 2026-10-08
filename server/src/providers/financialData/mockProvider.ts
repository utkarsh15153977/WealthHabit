import { FinancialConnectionProvider, FinancialAccountType, TransactionType } from '@prisma/client';
import { env } from '../../config/index.js';
import { AppError } from '../../utils/errors.js';
import { ApiErrorCodes } from '../../types/errorCodes.js';
import { addUtcDays, startOfUtcDay } from '../../utils/date.js';
import type {
  ExternalFinancialAccount,
  ExternalTransaction,
  FinancialDataProvider,
  ProviderConnectInput,
  ProviderConnectResult,
  ProviderTransactionQuery,
} from './types.js';

const MOCK_ACCOUNTS: ExternalFinancialAccount[] = [
  {
    externalAccountId: 'mock-hdfc-sav-001',
    name: 'HDFC Savings',
    mask: '1234',
    type: FinancialAccountType.SAVINGS,
    currency: 'INR',
    institutionName: 'HDFC',
  },
  {
    externalAccountId: 'mock-hdfc-debit-001',
    name: 'HDFC Debit Card',
    mask: '4821',
    type: FinancialAccountType.DEBIT_CARD,
    currency: 'INR',
    institutionName: 'HDFC',
  },
  {
    externalAccountId: 'mock-icici-credit-001',
    name: 'ICICI Credit Card',
    mask: '7812',
    type: FinancialAccountType.CREDIT_CARD,
    currency: 'INR',
    institutionName: 'ICICI',
  },
];

interface MockTransactionFixture {
  externalAccountId: string;
  date: string;
  sequence: string;
  amount: string;
  type: TransactionType;
  merchant: string;
  description: string;
  paymentMethod: string | null;
  paymentChannel: string | null;
}

const MOCK_TRANSACTION_FIXTURES: MockTransactionFixture[] = [
  {
    externalAccountId: 'mock-hdfc-sav-001',
    date: '2026-09-15',
    sequence: 'txn-001',
    amount: '125000.00',
    type: TransactionType.INCOME,
    merchant: 'Acme Corp',
    description: 'Salary credit',
    paymentMethod: 'BANK_TRANSFER',
    paymentChannel: null,
  },
  {
    externalAccountId: 'mock-hdfc-sav-001',
    date: '2026-09-20',
    sequence: 'txn-001',
    amount: '2340.00',
    type: TransactionType.EXPENSE,
    merchant: 'MSEB',
    description: 'Electricity bill payment',
    paymentMethod: 'UPI',
    paymentChannel: 'GOOGLEPAY',
  },
  {
    externalAccountId: 'mock-hdfc-sav-001',
    date: '2026-09-25',
    sequence: 'txn-001',
    amount: '275.00',
    type: TransactionType.EXPENSE,
    merchant: 'Uber',
    description: 'Uber ride',
    paymentMethod: 'UPI',
    paymentChannel: 'GOOGLEPAY',
  },
  {
    externalAccountId: 'mock-hdfc-sav-001',
    date: '2026-10-01',
    sequence: 'txn-001',
    amount: '125000.00',
    type: TransactionType.INCOME,
    merchant: 'Acme Corp',
    description: 'Salary credit',
    paymentMethod: 'BANK_TRANSFER',
    paymentChannel: null,
  },
  {
    externalAccountId: 'mock-hdfc-sav-001',
    date: '2026-10-02',
    sequence: 'txn-001',
    amount: '2150.00',
    type: TransactionType.EXPENSE,
    merchant: 'BigBasket',
    description: 'Grocery purchase',
    paymentMethod: 'UPI',
    paymentChannel: 'PHONEPE',
  },
  {
    externalAccountId: 'mock-hdfc-sav-001',
    date: '2026-10-03',
    sequence: 'txn-001',
    amount: '850.00',
    type: TransactionType.EXPENSE,
    merchant: 'Swiggy',
    description: 'UPI payment - Swiggy',
    paymentMethod: 'UPI',
    paymentChannel: 'PHONEPE',
  },
  {
    externalAccountId: 'mock-hdfc-sav-001',
    date: '2026-10-03',
    sequence: 'txn-002',
    amount: '320.00',
    type: TransactionType.EXPENSE,
    merchant: 'Uber',
    description: 'UPI payment - Uber',
    paymentMethod: 'UPI',
    paymentChannel: 'GOOGLEPAY',
  },
  {
    externalAccountId: 'mock-hdfc-sav-001',
    date: '2026-10-06',
    sequence: 'txn-001',
    amount: '1299.00',
    type: TransactionType.EXPENSE,
    merchant: 'Amazon',
    description: 'Amazon order',
    paymentMethod: 'UPI',
    paymentChannel: 'GOOGLEPAY',
  },
  {
    externalAccountId: 'mock-hdfc-sav-001',
    date: '2026-10-06',
    sequence: 'txn-002',
    amount: '2105.00',
    type: TransactionType.EXPENSE,
    merchant: 'MSEB',
    description: 'Electricity bill payment',
    paymentMethod: 'UPI',
    paymentChannel: 'GOOGLEPAY',
  },
  {
    externalAccountId: 'mock-hdfc-debit-001',
    date: '2026-09-18',
    sequence: 'txn-001',
    amount: '2000.00',
    type: TransactionType.EXPENSE,
    merchant: 'HP Petrol Pump',
    description: 'Fuel refill',
    paymentMethod: 'CARD',
    paymentChannel: null,
  },
  {
    externalAccountId: 'mock-hdfc-debit-001',
    date: '2026-09-28',
    sequence: 'txn-001',
    amount: '1460.00',
    type: TransactionType.EXPENSE,
    merchant: 'Reliance Fresh',
    description: 'Grocery purchase',
    paymentMethod: 'CARD',
    paymentChannel: null,
  },
  {
    externalAccountId: 'mock-hdfc-debit-001',
    date: '2026-10-04',
    sequence: 'txn-001',
    amount: '1800.00',
    type: TransactionType.EXPENSE,
    merchant: 'HP Petrol Pump',
    description: 'Fuel refill',
    paymentMethod: 'CARD',
    paymentChannel: null,
  },
  {
    externalAccountId: 'mock-hdfc-debit-001',
    date: '2026-10-04',
    sequence: 'txn-002',
    amount: '5000.00',
    type: TransactionType.EXPENSE,
    merchant: 'HDFC ATM',
    description: 'ATM cash withdrawal',
    paymentMethod: 'ATM',
    paymentChannel: null,
  },
  {
    externalAccountId: 'mock-hdfc-debit-001',
    date: '2026-10-06',
    sequence: 'txn-001',
    amount: '740.00',
    type: TransactionType.EXPENSE,
    merchant: 'Cafe Coffee Day',
    description: 'UPI payment - Cafe Coffee Day',
    paymentMethod: 'UPI',
    paymentChannel: 'PHONEPE',
  },
  {
    externalAccountId: 'mock-icici-credit-001',
    date: '2026-09-22',
    sequence: 'txn-001',
    amount: '8450.00',
    type: TransactionType.EXPENSE,
    merchant: 'IndiGo',
    description: 'Flight booking',
    paymentMethod: 'CARD',
    paymentChannel: null,
  },
  {
    externalAccountId: 'mock-icici-credit-001',
    date: '2026-09-28',
    sequence: 'txn-001',
    amount: '649.00',
    type: TransactionType.EXPENSE,
    merchant: 'Netflix',
    description: 'Netflix subscription',
    paymentMethod: 'CARD',
    paymentChannel: null,
  },
  {
    externalAccountId: 'mock-icici-credit-001',
    date: '2026-10-02',
    sequence: 'txn-001',
    amount: '4599.00',
    type: TransactionType.EXPENSE,
    merchant: 'Amazon',
    description: 'Amazon order',
    paymentMethod: 'CARD',
    paymentChannel: null,
  },
  {
    externalAccountId: 'mock-icici-credit-001',
    date: '2026-10-05',
    sequence: 'txn-001',
    amount: '649.00',
    type: TransactionType.EXPENSE,
    merchant: 'Netflix',
    description: 'Netflix subscription',
    paymentMethod: 'CARD',
    paymentChannel: null,
  },
  {
    externalAccountId: 'mock-icici-credit-001',
    date: '2026-10-07',
    sequence: 'txn-001',
    amount: '1120.00',
    type: TransactionType.EXPENSE,
    merchant: 'Truffles',
    description: 'Restaurant - Truffles',
    paymentMethod: 'CARD',
    paymentChannel: null,
  },
];

function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toExternalTransaction(fixture: MockTransactionFixture): ExternalTransaction {
  return {
    externalTransactionId: `${fixture.externalAccountId}:${fixture.date}:${fixture.sequence}`,
    amount: fixture.amount,
    type: fixture.type,
    transactionDate: toUtcDate(fixture.date),
    description: fixture.description,
    merchant: fixture.merchant,
    paymentMethod: fixture.paymentMethod,
    paymentChannel: fixture.paymentChannel,
    externalAccountId: fixture.externalAccountId,
  };
}

function compareTransactions(a: ExternalTransaction, b: ExternalTransaction): number {
  const byDate = a.transactionDate.getTime() - b.transactionDate.getTime();
  if (byDate !== 0) {
    return byDate;
  }
  return (a.externalTransactionId ?? '').localeCompare(b.externalTransactionId ?? '');
}

export class MockFinancialProvider implements FinancialDataProvider {
  public readonly provider = FinancialConnectionProvider.MOCK;

  constructor() {
    if (env.isProduction) {
      throw AppError.badRequest(
        'Financial data provider is not supported',
        undefined,
        ApiErrorCodes.PROVIDER_NOT_SUPPORTED
      );
    }
  }

  public async connect(input: ProviderConnectInput): Promise<ProviderConnectResult> {
    return { externalConnectionRef: `mock-connection-${input.userId}` };
  }

  public async getAccounts(): Promise<ExternalFinancialAccount[]> {
    return MOCK_ACCOUNTS.map((account) => ({ ...account }));
  }

  public async getTransactions(input: ProviderTransactionQuery): Promise<ExternalTransaction[]> {
    const rangeStart = startOfUtcDay(input.from);
    const rangeEnd = addUtcDays(startOfUtcDay(input.to), 1);

    return MOCK_TRANSACTION_FIXTURES.filter((fixture) => {
      const transactionDate = toUtcDate(fixture.date).getTime();
      return transactionDate >= rangeStart.getTime() && transactionDate < rangeEnd.getTime();
    })
      .map(toExternalTransaction)
      .sort(compareTransactions);
  }

  public async disconnect(): Promise<void> {
    return;
  }
}
