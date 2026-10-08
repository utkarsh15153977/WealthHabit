import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  connectFinancialConnectionWithAccounts,
  reactivateFinancialConnection,
  findUserConnections,
  getUserConnectionOrThrow,
  listUserAccounts,
  getUserAccountOrThrow,
} from '../services/prismaFinancialConnectionService.js';
import { syncFinancialAccount } from '../services/prismaFinancialSyncService.js';
import {
  CreateFinancialConnectionInput,
  ConnectionIdParam,
  AccountIdParam,
  ListFinancialAccountsQuery,
  SyncFinancialAccountQuery,
} from '../schemas/financialConnectionSchemas.js';
import { getFinancialDataProvider } from '../providers/financialData/registry.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { recordAuditEvent, AuditActions } from '../services/auditLogService.js';
import { prisma } from '../config/prisma.js';
import { FinancialConnectionStatus, Prisma } from '@prisma/client';
import type {
  FinancialConnectionDto,
  FinancialAccountDto,
  FinancialAccountSyncSummaryDto,
} from '../types/financialConnection.js';

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * Provider failures must never surface raw provider text to the client.
 * AppErrors raised by a provider are preserved (they already carry a safe
 * message and code); anything else becomes a sanitized 502.
 */
function toProviderError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return new AppError(
    'Financial data provider request failed',
    502,
    undefined,
    ApiErrorCodes.PROVIDER_ERROR
  );
}

function toAccountDto(account: FinancialAccountDto): FinancialAccountDto {
  return {
    id: account.id,
    externalAccountId: account.externalAccountId,
    name: account.name,
    mask: account.mask,
    type: account.type,
    currency: account.currency,
    institutionName: account.institutionName,
    isActive: account.isActive,
    lastSyncedAt: account.lastSyncedAt,
    lastSyncError: account.lastSyncError,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function toConnectionDto(connection: FinancialConnectionDto & { accounts?: FinancialAccountDto[] }): FinancialConnectionDto {
  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    institutionName: connection.institutionName,
    consentGivenAt: connection.consentGivenAt,
    revokedAt: connection.revokedAt,
    lastSyncedAt: connection.lastSyncedAt,
    lastSyncError: connection.lastSyncError,
    accounts: (connection.accounts ?? []).map(toAccountDto),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function readLastSyncSummary(raw: unknown): FinancialAccountSyncSummaryDto['lastSync'] {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const { transactionsFetched, transactionsImported, transactionsSkipped, syncedAt } = value;
  if (
    typeof transactionsFetched !== 'number' ||
    typeof transactionsImported !== 'number' ||
    typeof transactionsSkipped !== 'number' ||
    typeof syncedAt !== 'string'
  ) {
    return null;
  }
  return { transactionsFetched, transactionsImported, transactionsSkipped, syncedAt };
}

export async function createFinancialConnection(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateFinancialConnectionInput;

  const existing = await prisma.financialConnection.findFirst({
    where: { userId, provider: input.provider },
  });
  const isReactivation =
    existing !== null && existing.status === FinancialConnectionStatus.DISCONNECTED;

  if (existing && !isReactivation) {
    throw new AppError(
      'A connection for this provider already exists',
      409,
      undefined,
      ApiErrorCodes.CONNECTION_ALREADY_EXISTS
    );
  }

  const provider = getFinancialDataProvider(input.provider);

  if (isReactivation && existing) {
    let connection;
    try {
      connection = await reactivateFinancialConnection(existing.id, userId, provider);
    } catch (err) {
      throw toProviderError(err);
    }

    await recordAuditEvent(
      {
        actorUserId: userId,
        action: AuditActions.FINANCIAL_CONNECTION_REACTIVATED,
        entityType: 'financial_connection',
        entityId: connection.id,
        metadata: {
          connectionId: connection.id,
          provider: connection.provider,
          accountCount: connection.accounts.length,
        },
      },
      prisma
    );

    res.json({ success: true, data: toConnectionDto(connection) });
    return;
  }

  let connectResult;
  try {
    connectResult = await provider.connect({ userId, consent: {} });
  } catch (err) {
    throw toProviderError(err);
  }

  let connection;
  try {
    connection = await connectFinancialConnectionWithAccounts(
      userId,
      input.provider,
      connectResult.externalConnectionRef,
      provider
    );
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new AppError(
        'A connection for this provider already exists',
        409,
        undefined,
        ApiErrorCodes.CONNECTION_ALREADY_EXISTS
      );
    }
    throw toProviderError(err);
  }

  await recordAuditEvent(
    {
      actorUserId: userId,
      action: AuditActions.FINANCIAL_CONNECTION_CREATED,
      entityType: 'financial_connection',
      entityId: connection.id,
      metadata: {
        connectionId: connection.id,
        provider: connection.provider,
        accountCount: connection.accounts.length,
      },
    },
    prisma
  );

  res.status(201).json({
    success: true,
    data: toConnectionDto(connection),
  });
}

export async function listFinancialConnections(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const connections = await findUserConnections(userId);
  res.json({
    success: true,
    data: connections.map(toConnectionDto),
  });
}

export async function getFinancialConnection(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as ConnectionIdParam;
  const connection = await getUserConnectionOrThrow(id, userId);
  res.json({
    success: true,
    data: toConnectionDto(connection),
  });
}

export async function disconnectFinancialConnection(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as ConnectionIdParam;
  const connection = await getUserConnectionOrThrow(id, userId);

  try {
    const provider = getFinancialDataProvider(connection.provider);
    await provider.disconnect(connection.id);
  } catch {
    // continue with disconnect
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.financialConnection.update({
      where: { id: connection.id },
      data: {
        status: FinancialConnectionStatus.DISCONNECTED,
        revokedAt: now,
      },
    });

    // Delete the connection's accounts so Transaction.financialAccountId is
    // set to NULL by the schema's SetNull rule. Imported transactions and
    // their history are preserved; only the link to the revoked account goes.
    await tx.financialAccount.deleteMany({ where: { connectionId: connection.id } });

    await recordAuditEvent(
      {
        actorUserId: userId,
        action: AuditActions.FINANCIAL_CONNECTION_DISCONNECTED,
        entityType: 'financial_connection',
        entityId: connection.id,
        metadata: { connectionId: connection.id, provider: connection.provider },
      },
      tx
    );
  });

  res.json({ success: true });
}

export async function listFinancialAccounts(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListFinancialAccountsQuery;

  if (query.connectionId) {
    await getUserConnectionOrThrow(query.connectionId, userId);
  }

  const accounts = await listUserAccounts(userId, query.connectionId);
  res.json({
    success: true,
    data: { accounts: accounts.map(toAccountDto) },
  });
}

export async function getFinancialAccount(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as AccountIdParam;
  const account = await getUserAccountOrThrow(id, userId);
  res.json({
    success: true,
    data: toAccountDto(account),
  });
}

export async function syncFinancialAccountHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as AccountIdParam;
  const query = (req.query ?? {}) as SyncFinancialAccountQuery;
  const result = await syncFinancialAccount(id, userId, {
    from: query.from,
    to: query.to,
  });
  res.json({ success: true, data: result });
}

export async function getFinancialAccountSyncSummaryHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as AccountIdParam;
  const account = await getUserAccountOrThrow(id, userId);

  const data: FinancialAccountSyncSummaryDto = {
    accountId: account.id,
    accountName: account.name,
    status: account.connection.status,
    isActive: account.isActive,
    lastSyncedAt: account.lastSyncedAt,
    lastSyncError: account.lastSyncError,
    lastSync: readLastSyncSummary(account.lastSyncSummary),
  };

  res.json({ success: true, data });
}
