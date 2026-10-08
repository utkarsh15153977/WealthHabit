import { FinancialConnectionProvider, FinancialAccountType, TransactionType } from '@prisma/client';

export interface ExternalFinancialAccount {
  externalAccountId: string;
  name: string;
  mask: string | null;
  type: FinancialAccountType;
  currency: string;
  institutionName: string | null;
}

export interface ExternalTransaction {
  externalTransactionId: string | null;
  amount: string;
  type: TransactionType;
  transactionDate: Date;
  description: string | null;
  merchant: string | null;
  paymentMethod: string | null;
  paymentChannel: string | null;
  externalAccountId: string;
}

export interface ProviderConnectInput {
  userId: string;
  consent: unknown;
}

export interface ProviderConnectResult {
  externalConnectionRef: string;
}

export interface ProviderTransactionQuery {
  connectionId: string;
  from: Date;
  to: Date;
}

export interface FinancialDataProvider {
  readonly provider: FinancialConnectionProvider;
  connect(input: ProviderConnectInput): Promise<ProviderConnectResult>;
  getAccounts(connectionId: string): Promise<ExternalFinancialAccount[]>;
  getTransactions(input: ProviderTransactionQuery): Promise<ExternalTransaction[]>;
  disconnect(connectionId: string): Promise<void>;
}
