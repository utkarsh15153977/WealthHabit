import {
  FinancialAccount,
  FinancialConnectionProvider,
  FinancialConnectionStatus,
} from '@prisma/client';

export type FinancialAccountType = FinancialAccount['type'];

export interface FinancialAccountDto {
  id: string;
  externalAccountId: string;
  name: string;
  mask: string | null;
  type: FinancialAccountType;
  currency: string;
  institutionName: string | null;
  isActive: boolean;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancialConnectionDto {
  id: string;
  provider: FinancialConnectionProvider;
  status: FinancialConnectionStatus;
  institutionName: string | null;
  consentGivenAt: Date | null;
  revokedAt: Date | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  accounts: FinancialAccountDto[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancialAccountSyncSummaryDto {
  accountId: string;
  accountName: string;
  status: FinancialConnectionStatus;
  isActive: boolean;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  lastSync: {
    transactionsFetched: number;
    transactionsImported: number;
    transactionsSkipped: number;
    syncedAt: string;
  } | null;
}

export interface CreateFinancialConnectionInputDto {
  provider: FinancialConnectionProvider;
}

export interface SyncResultDto {
  accountId: string;
  transactionsFetched: number;
  transactionsImported: number;
  transactionsSkipped: number;
  lastSyncedAt: Date;
}
