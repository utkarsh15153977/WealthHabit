import { FinancialConnection, FinancialAccount, Prisma, FinancialConnectionProvider } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export type FinancialConnectionWithAccounts = FinancialConnection & {
  accounts: FinancialAccount[];
};

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
  accounts: {
    externalAccountId: string;
    name: string;
    mask: string | null;
    type: FinancialAccount['type'];
    currency: string;
    institutionName: string | null;
  }[]
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
