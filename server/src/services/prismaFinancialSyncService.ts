import crypto from 'crypto';
import {
  CategoryType,
  TransactionType,
  TransactionSource,
  FinancialConnectionStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { recordAuditEvent, AuditActions } from './auditLogService.js';
import { getFinancialDataProvider } from '../providers/financialData/registry.js';
import type { ExternalTransaction } from '../providers/financialData/types.js';
import { findUserAccount } from './prismaFinancialConnectionService.js';
import { listUserCategories } from './prismaCategoryService.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { AppError } from '../utils/errors.js';
import { SyncResultDto } from '../types/financialConnection.js';

const DESCRIPTION_MAX_LENGTH = 500;
const PAYMENT_METHOD_MAX_LENGTH = 100;
const DEFAULT_SYNC_WINDOW_DAYS = 90;

interface CategoryRule {
  merchantPatterns: RegExp[];
  incomeCategory: string | null;
  expenseCategory: string;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    merchantPatterns: [/swiggy/i, /bigbasket/i, /reliance fresh/i, /grocery/i],
    incomeCategory: null,
    expenseCategory: 'Food',
  },
  {
    merchantPatterns: [/amazon/i, /flipkart/i, /myntra/i],
    incomeCategory: null,
    expenseCategory: 'Shopping',
  },
  {
    merchantPatterns: [/uber/i, /ola/i, /rapido/i],
    incomeCategory: null,
    expenseCategory: 'Transportation',
  },
  {
    merchantPatterns: [/mseb/i, /electricity/i, /power/i],
    incomeCategory: null,
    expenseCategory: 'Utilities',
  },
  {
    merchantPatterns: [/netflix/i, /spotify/i, /prime video/i, /hotstar/i, /disney/i],
    incomeCategory: null,
    expenseCategory: 'Entertainment',
  },
  {
    merchantPatterns: [/hp petrol/i, /petrol/i, /fuel/i, /indian oil/i, /bharat petroleum/i],
    incomeCategory: null,
    expenseCategory: 'Transportation',
  },
  {
    merchantPatterns: [/acme corp/i, /salary/i, /payroll/i],
    incomeCategory: 'Salary',
    expenseCategory: 'Other Expense',
  },
];

/**
 * In-process single-flight guard keyed by financial account id. Process-local
 * by design for Phase 6D: a second sync request for an account already being
 * synced fails fast with SYNC_ALREADY_IN_PROGRESS instead of racing. If
 * background workers are ever introduced, this must become a distributed lock.
 */
const syncLocks = new Map<string, Promise<SyncResultDto>>();

export interface NormalizedImportTransaction {
  amount: Prisma.Decimal;
  type: TransactionType;
  transactionDate: Date;
  description: string | null;
  paymentMethod: string | null;
  paymentChannel: string | null;
  merchant: string | null;
  externalTransactionId: string | null;
  dedupKey: string | null;
}

export interface ResolvedImportTransaction extends NormalizedImportTransaction {
  categoryId: string;
  financialAccountId: string;
}

type CategoryLookup = Map<string, { id: string; name: string; type: CategoryType | TransactionType }>;

export function resolveCategoryName(merchant: string | null, type: TransactionType): string {
  if (merchant) {
    for (const rule of CATEGORY_RULES) {
      if (!rule.merchantPatterns.some((pattern) => pattern.test(merchant))) {
        continue;
      }
      if (type === TransactionType.INCOME && rule.incomeCategory) {
        return rule.incomeCategory;
      }
      if (type === TransactionType.EXPENSE) {
        return rule.expenseCategory;
      }
    }
  }
  return type === TransactionType.INCOME ? 'Other Income' : 'Other Expense';
}

export function generateDedupKey(
  userId: string,
  financialAccountId: string,
  amount: string,
  transactionDate: Date,
  merchant: string | null,
  type: TransactionType
): string {
  const dateKey = transactionDate.toISOString().split('T')[0];
  const base = `${userId}|${financialAccountId}|${amount}|${dateKey}|${merchant ?? ''}|${type}`;
  return crypto.createHash('sha256').update(base).digest('hex');
}

/**
 * Converts a provider ExternalTransaction into the shape required by the
 * existing Transaction model. Amount must be positive, the date valid, and
 * description/paymentMethod must fit the limits enforced by
 * transactionSchemas. Returns null for a row that cannot be represented so a
 * single malformed provider row cannot abort an entire sync.
 */
export function normalizeExternalTransaction(
  external: ExternalTransaction,
  userId: string,
  financialAccountId: string
): NormalizedImportTransaction | null {
  const numericAmount = Number(external.amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return null;
  }

  const transactionDate = external.transactionDate;
  if (!(transactionDate instanceof Date) || Number.isNaN(transactionDate.getTime())) {
    return null;
  }

  const description = external.description
    ? external.description.trim().slice(0, DESCRIPTION_MAX_LENGTH)
    : null;
  const paymentMethod = external.paymentMethod
    ? external.paymentMethod.trim().slice(0, PAYMENT_METHOD_MAX_LENGTH)
    : null;
  const merchant = external.merchant ? external.merchant.trim() : null;

  return {
    amount: new Prisma.Decimal(external.amount),
    type: external.type,
    transactionDate,
    description,
    paymentMethod,
    paymentChannel: external.paymentChannel,
    merchant,
    externalTransactionId: external.externalTransactionId,
    // Rows carrying a provider id are deduplicated against the
    // (financialAccountId, externalTransactionId) unique constraint, so they
    // take no dedupKey. Only rows without one get the sha256 fallback key.
    dedupKey: external.externalTransactionId
      ? null
      : generateDedupKey(
          userId,
          financialAccountId,
          external.amount,
          transactionDate,
          merchant,
          external.type
        ),
  };
}

/**
 * Maps a normalized transaction onto an existing Category. Merchant rules
 * first, then the global default ("Other Income" / "Other Expense"). The
 * resolved category type must equal the transaction type; a rule pointing at
 * a mismatched type falls through to the default. Never creates categories.
 */
export function resolveCategoryId(
  normalized: NormalizedImportTransaction,
  categoriesByName: CategoryLookup
): string {
  const sameType = (
    left: CategoryType | TransactionType,
    right: CategoryType | TransactionType
  ): boolean => String(left) === String(right);

  const categoryName = resolveCategoryName(normalized.merchant, normalized.type);
  const matched = categoriesByName.get(categoryName.toLowerCase());
  if (matched && sameType(matched.type, normalized.type)) {
    return matched.id;
  }

  const fallbackName =
    normalized.type === TransactionType.INCOME ? 'Other Income' : 'Other Expense';
  const fallback = categoriesByName.get(fallbackName.toLowerCase());
  if (fallback && sameType(fallback.type, normalized.type)) {
    return fallback.id;
  }

  throw new AppError(
    'No usable category available for import',
    500,
    undefined,
    ApiErrorCodes.CATEGORY_NOT_FOUND
  );
}

export function isSyncInProgress(accountId: string): boolean {
  return syncLocks.has(accountId);
}

export async function syncFinancialAccount(
  accountId: string,
  userId: string,
  options?: { from?: Date; to?: Date }
): Promise<SyncResultDto> {
  if (syncLocks.has(accountId)) {
    throw new AppError(
      'A sync for this account is already in progress',
      409,
      undefined,
      ApiErrorCodes.SYNC_ALREADY_IN_PROGRESS
    );
  }

  const lock = doSync(accountId, userId, options)
    .catch((error: unknown) => {
      void recordSyncFailure(accountId, userId, error);
      throw error;
    })
    .finally(() => {
      syncLocks.delete(accountId);
    });

  syncLocks.set(accountId, lock);
  return lock;
}

async function recordSyncFailure(
  accountId: string,
  userId: string,
  error: unknown
): Promise<void> {
  try {
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId },
      select: { connectionId: true, connection: { select: { provider: true } } },
    });
    if (!account) {
      return;
    }
    await recordAuditEvent(
      {
        actorUserId: userId,
        action: AuditActions.FINANCIAL_SYNC_FAILED,
        entityType: 'financial_connection',
        entityId: account.connectionId,
        metadata: {
          connectionId: account.connectionId,
          accountId,
          provider: account.connection.provider,
          errorCode:
            error instanceof AppError && error.code ? error.code : ApiErrorCodes.SYNC_FAILED,
        },
      },
      prisma
    );
  } catch {
    // Audit failure must never mask the original sync error.
  }
}

async function doSync(
  accountId: string,
  userId: string,
  options?: { from?: Date; to?: Date }
): Promise<SyncResultDto> {
  const account = await findUserAccount(accountId, userId);
  if (!account) {
    throw new AppError(
      'Financial account not found',
      404,
      undefined,
      ApiErrorCodes.FINANCIAL_ACCOUNT_NOT_FOUND
    );
  }

  const connection = account.connection;
  if (connection.status !== FinancialConnectionStatus.ACTIVE) {
    throw new AppError(
      'Connection is no longer active',
      400,
      undefined,
      ApiErrorCodes.CONNECTION_REVOKED
    );
  }

  const provider = getFinancialDataProvider(connection.provider);
  const today = new Date();
  const from =
    options?.from ?? new Date(today.getTime() - DEFAULT_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const to = options?.to ?? today;

  let externalTxns: ExternalTransaction[];
  try {
    externalTxns = await provider.getTransactions({ connectionId: connection.id, from, to });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('Sync failed', 500, undefined, ApiErrorCodes.SYNC_FAILED);
  }

  // Normalization + category resolution happen outside the transaction: they
  // are pure reads over already-fetched provider data.
  //
  // The provider returns connection-scoped rows carrying an externalAccountId,
  // while the sync endpoint is invoked for a single FinancialAccount. Each row
  // is linked to the FinancialAccount that owns its externalAccountId, so a
  // sync of any account of the connection imports every provider row exactly
  // once under its real account instead of double-counting them across
  // sibling accounts.
  const connectionAccounts = await prisma.financialAccount.findMany({
    where: { connectionId: connection.id },
    select: { id: true, externalAccountId: true },
  });
  const financialAccountIdByExternalId = new Map(
    connectionAccounts.map((row) => [row.externalAccountId, row.id])
  );
  const connectionAccountIds = connectionAccounts.map((row) => row.id);

  const categories = await listUserCategories(userId);
  const categoriesByName: CategoryLookup = new Map(
    categories.map((category) => [category.name.toLowerCase(), category])
  );

  const resolved: ResolvedImportTransaction[] = [];
  for (const external of externalTxns) {
    const targetAccountId = financialAccountIdByExternalId.get(external.externalAccountId);
    if (!targetAccountId) {
      continue;
    }
    const normalized = normalizeExternalTransaction(external, userId, targetAccountId);
    if (!normalized) {
      continue;
    }
    resolved.push({
      ...normalized,
      categoryId: resolveCategoryId(normalized, categoriesByName),
      financialAccountId: targetAccountId,
    });
  }

  const now = new Date();
  const fetched = externalTxns.length;
  let imported = 0;

  try {
    await prisma.$transaction(
      async (tx) => {
        const externalIds = resolved
          .map((row) => row.externalTransactionId)
          .filter((id): id is string => id !== null);
        const dedupKeys = resolved
          .map((row) => row.dedupKey)
          .filter((key): key is string => key !== null);

        const existingRows =
          externalIds.length > 0 || dedupKeys.length > 0
            ? await tx.transaction.findMany({
                where: {
                  OR: [
                    {
                      financialAccountId: { in: connectionAccountIds },
                      externalTransactionId: { in: externalIds },
                    },
                    { userId, dedupKey: { in: dedupKeys } },
                  ],
                },
                select: { financialAccountId: true, externalTransactionId: true, dedupKey: true },
              })
            : [];

        const seenExternalIds = new Set(
          existingRows
            .filter((row) => row.externalTransactionId)
            .map((row) => `${row.financialAccountId}:${row.externalTransactionId}`)
        );
        const seenDedupKeys = new Set(
          existingRows.map((row) => row.dedupKey).filter((key): key is string => key !== null)
        );

        const rowsToInsert: Prisma.TransactionCreateManyInput[] = [];
        for (const row of resolved) {
          const externalKey = row.externalTransactionId
            ? `${row.financialAccountId}:${row.externalTransactionId}`
            : null;
          if (externalKey && seenExternalIds.has(externalKey)) {
            continue;
          }
          if (row.dedupKey && seenDedupKeys.has(row.dedupKey)) {
            continue;
          }
          if (externalKey) {
            seenExternalIds.add(externalKey);
          }
          if (row.dedupKey) {
            seenDedupKeys.add(row.dedupKey);
          }

          rowsToInsert.push({
            userId,
            categoryId: row.categoryId,
            type: row.type,
            amount: row.amount,
            description: row.description,
            transactionDate: row.transactionDate,
            paymentMethod: row.paymentMethod,
            paymentChannel: row.paymentChannel,
            financialAccountId: row.financialAccountId,
            source: TransactionSource.IMPORTED,
            externalTransactionId: row.externalTransactionId,
            merchant: row.merchant,
            dedupKey: row.dedupKey,
            importedAt: now,
          });
        }

        if (rowsToInsert.length > 0) {
          const created = await tx.transaction.createMany({
            data: rowsToInsert,
            skipDuplicates: true,
          });
          imported = created.count;
        }

        await tx.financialAccount.update({
          where: { id: account.id },
          data: { lastSyncedAt: now },
        });

        await tx.financialConnection.update({
          where: { id: connection.id },
          data: { lastSyncedAt: now, lastSyncError: null },
        });

        await recordAuditEvent(
          {
            actorUserId: userId,
            action: AuditActions.FINANCIAL_SYNC_COMPLETED,
            entityType: 'financial_connection',
            entityId: connection.id,
            metadata: {
              connectionId: connection.id,
              accountId: account.id,
              provider: connection.provider,
              transactionsFetched: fetched,
              transactionsImported: imported,
              transactionsSkipped: fetched - imported,
            },
          },
          tx
        );
      },
      { timeout: 30_000 }
    );
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('Sync failed', 500, undefined, ApiErrorCodes.SYNC_FAILED);
  }

  return {
    accountId: account.id,
    transactionsFetched: fetched,
    transactionsImported: imported,
    transactionsSkipped: fetched - imported,
    lastSyncedAt: now,
  };
}
