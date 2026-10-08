import { FinancialConnection, FinancialAccount, Prisma, FinancialConnectionProvider } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import type { FinancialDataProvider } from '../providers/financialData/types.js';

export type FinancialConnectionWithAccounts = FinancialConnection & {
  accounts: FinancialAccount[];
};

export interface ExternalAccountInput {
  externalAccountId: string;
  name: string;
  mask: string | null;
  type: FinancialAccount['type'];
  currency: string;
  institutionName: string | null;
}

const TRANSACTION_OPTIONS = { timeout: 15000, maxWait: 5000 };

export async function createFinancialConnection(
  userId: string,
  provider: FinancialConnectionProvider,
  connectionRef: string | null
): Promise<FinancialConnectionWithAccounts> {
  // import type will be handled below
  return prisma.financialConnection.create({
    data: {
      userId,
      provider,
      status: 'ACTIVE' as const,
      consentGivenAt: new Date(),
      providerMetadata: connectionRef ? { connectionRef } : undefined,
    },
    include: {
      accounts: true,
    },
  });
}

export async function findUserConnections(
  userId: string
): Promise<FinancialConnectionWithAccounts[]> {
  return prisma.financialConnection.findMany({
    where: { userId },
    include: { accounts: true },
    orderBy: [{ createdAt: 'desc' }],
  });
}

export async function findUserConnection(
  connectionId: string,
  userId: string
): Promise<FinancialConnectionWithAccounts | null> {
  return prisma.financialConnection.findFirst({
    where: { id: connectionId, userId },
    include: { accounts: true },
  });
}

export async function getUserConnectionOrThrow(
  connectionId: string,
  userId: string
): Promise<FinancialConnectionWithAccounts> {
  const connection = await findUserConnection(connectionId, userId);
  if (!connection) {
    const { AppError } = await import('../utils/errors.js');
    const { ApiErrorCodes } = await import('../types/errorCodes.js');
    throw AppError.notFound('Financial connection not found', ApiErrorCodes.FINANCIAL_CONNECTION_NOT_FOUND);
  }
  return connection;
}

export async function updateConnectionStatus(
  connectionId: string,
  status: FinancialConnection['status'],
  revokedAt: Date | null = null,
  lastSyncedAt: Date | null = null,
  lastSyncError: string | null = null
): Promise<FinancialConnection> {
  return prisma.financialConnection.update({
    where: { id: connectionId },
    data: {
      status,
      revokedAt,
      lastSyncedAt: lastSyncedAt ?? undefined,
      lastSyncError,
    },
  });
}

export async function findUserAccount(
  accountId: string,
  userId: string
): Promise<(FinancialAccount & { connection: FinancialConnection }) | null> {
  return prisma.financialAccount.findFirst({
    where: { id: accountId, userId },
    include: { connection: true },
  });
}

export async function getUserAccountOrThrow(
  accountId: string,
  userId: string
): Promise<FinancialAccount & { connection: FinancialConnection }> {
  const account = await findUserAccount(accountId, userId);
  if (!account) {
    const { AppError } = await import('../utils/errors.js');
    const { ApiErrorCodes } = await import('../types/errorCodes.js');
    throw AppError.notFound('Financial account not found', ApiErrorCodes.FINANCIAL_ACCOUNT_NOT_FOUND);
  }
  return account;
}

export async function listUserAccounts(
  userId: string,
  connectionId?: string
): Promise<(FinancialAccount & { connection: FinancialConnection })[]> {
  const where: Prisma.FinancialAccountWhereInput = { userId };
  if (connectionId) {
    where.connectionId = connectionId;
  }
  return prisma.financialAccount.findMany({
    where,
    include: { connection: true },
    orderBy: [{ createdAt: 'desc' }],
  });
}

export async function createFinancialAccounts(
  connectionId: string,
  userId: string,
  accounts: ExternalAccountInput[]
): Promise<FinancialAccount[]> {
  if (accounts.length === 0) {
    return [];
  }
  return prisma.$transaction(async (tx) => {
    const created: FinancialAccount[] = [];
    for (const account of accounts) {
      const createdAccount = await tx.financialAccount.create({
        data: {
          connectionId,
          userId,
          externalAccountId: account.externalAccountId,
          name: account.name,
          mask: account.mask,
          type: account.type,
          currency: account.currency,
          institutionName: account.institutionName,
          isActive: true,
        },
      });
      created.push(createdAccount);
    }
    return created;
  });
}

/**
 * Makes the connection's stored accounts match the provider's account list:
 * existing rows are updated and reactivated, new provider accounts are
 * created, and accounts that disappeared upstream are deactivated (never
 * deleted, because deleting would sever Transaction links).
 */
async function reconcileFinancialAccounts(
  tx: Prisma.TransactionClient,
  connectionId: string,
  userId: string,
  externalAccounts: ExternalAccountInput[]
): Promise<void> {
  const existing = await tx.financialAccount.findMany({ where: { connectionId } });
  const existingByExternalId = new Map(existing.map((account) => [account.externalAccountId, account]));
  const providerExternalIds = new Set(externalAccounts.map((account) => account.externalAccountId));

  for (const external of externalAccounts) {
    const current = existingByExternalId.get(external.externalAccountId);
    if (current) {
      await tx.financialAccount.update({
        where: { id: current.id },
        data: {
          name: external.name,
          mask: external.mask,
          type: external.type,
          currency: external.currency,
          institutionName: external.institutionName,
          isActive: true,
        },
      });
      continue;
    }
    await tx.financialAccount.create({
      data: {
        connectionId,
        userId,
        externalAccountId: external.externalAccountId,
        name: external.name,
        mask: external.mask,
        type: external.type,
        currency: external.currency,
        institutionName: external.institutionName,
        isActive: true,
      },
    });
  }

  for (const account of existing) {
    if (!providerExternalIds.has(account.externalAccountId) && account.isActive) {
      await tx.financialAccount.update({
        where: { id: account.id },
        data: { isActive: false },
      });
    }
  }
}

function deriveInstitutionName(externalAccounts: ExternalAccountInput[]): string | null {
  return externalAccounts.find((account) => account.institutionName)?.institutionName ?? null;
}

/**
 * Creates the connection and its accounts atomically. The provider's account
 * fetch runs inside the same transaction, so a provider failure rolls the
 * connection back and never leaves an orphan connection row.
 */
export async function connectFinancialConnectionWithAccounts(
  userId: string,
  provider: FinancialConnectionProvider,
  connectionRef: string | null,
  dataProvider: FinancialDataProvider
): Promise<FinancialConnectionWithAccounts> {
  return prisma.$transaction(async (tx) => {
    const connection = await tx.financialConnection.create({
      data: {
        userId,
        provider,
        status: 'ACTIVE' as const,
        consentGivenAt: new Date(),
        providerMetadata: connectionRef ? { connectionRef } : undefined,
      },
    });

    const externalAccounts = await dataProvider.getAccounts(connection.id);
    await reconcileFinancialAccounts(tx, connection.id, userId, externalAccounts);

    const institutionName = deriveInstitutionName(externalAccounts);
    return tx.financialConnection.update({
      where: { id: connection.id },
      data: institutionName ? { institutionName } : {},
      include: { accounts: { orderBy: [{ createdAt: 'asc' }] } },
    });
  }, TRANSACTION_OPTIONS);
}

/**
 * Re-grants consent on a previously disconnected connection: provider
 * accounts are reconciled (recreated for the accounts disconnect removed) and
 * the connection returns to ACTIVE with no lingering revocation or sync error.
 */
export async function reactivateFinancialConnection(
  connectionId: string,
  userId: string,
  dataProvider: FinancialDataProvider
): Promise<FinancialConnectionWithAccounts> {
  return prisma.$transaction(async (tx) => {
    const connection = await tx.financialConnection.findFirst({
      where: { id: connectionId, userId },
    });
    if (!connection) {
      throw AppError.notFound(
        'Financial connection not found',
        ApiErrorCodes.FINANCIAL_CONNECTION_NOT_FOUND
      );
    }

    const externalAccounts = await dataProvider.getAccounts(connection.id);
    await reconcileFinancialAccounts(tx, connection.id, userId, externalAccounts);

    const institutionName = connection.institutionName ?? deriveInstitutionName(externalAccounts);
    return tx.financialConnection.update({
      where: { id: connection.id },
      data: {
        status: 'ACTIVE' as const,
        consentGivenAt: new Date(),
        revokedAt: null,
        lastSyncError: null,
        institutionName: institutionName ?? undefined,
      },
      include: { accounts: { orderBy: [{ createdAt: 'asc' }] } },
    });
  }, TRANSACTION_OPTIONS);
}

