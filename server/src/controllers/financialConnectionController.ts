import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  createFinancialConnection as createConnectionService,
  createFinancialAccounts,
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
import type { FinancialConnectionDto, FinancialAccountDto } from '../types/financialConnection.js';

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
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
    accounts: (connection.accounts ?? []).map(toAccountDto),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export async function createFinancialConnection(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateFinancialConnectionInput;

  const existing = await prisma.financialConnection.findFirst({
    where: { userId, provider: input.provider },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(
      'A connection for this provider already exists',
      409,
      undefined,
      ApiErrorCodes.CONNECTION_ALREADY_EXISTS
    );
  }

  const provider = getFinancialDataProvider(input.provider);
  const connectResult = await provider.connect({ userId, consent: {} });

  let connection;
  try {
    connection = await createConnectionService(userId, input.provider, connectResult.externalConnectionRef);
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new AppError(
        'A connection for this provider already exists',
        409,
        undefined,
        ApiErrorCodes.CONNECTION_ALREADY_EXISTS
      );
    }
    throw err;
  }

  const externalAccounts = await provider.getAccounts(connection.id);
  if (externalAccounts.length > 0) {
    const createdAccounts = await createFinancialAccounts(
      connection.id,
      userId,
      externalAccounts.map((account) => ({
        externalAccountId: account.externalAccountId,
        name: account.name,
        mask: account.mask,
        type: account.type,
        currency: account.currency,
        institutionName: account.institutionName,
      }))
    );
    connection.accounts = createdAccounts;
  }

  const institutionName =
    externalAccounts.find((account) => account.institutionName)?.institutionName ?? null;
  if (institutionName) {
    connection.institutionName = institutionName;
    await prisma.financialConnection.update({
      where: { id: connection.id },
      data: { institutionName },
    });
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
