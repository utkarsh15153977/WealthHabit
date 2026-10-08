import { Response } from 'express';
import { CategoryType, TransactionSource } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  ListImportedTransactionsQuery,
  TransactionCategoryInput,
} from '../schemas/transactionSchemas.js';
import {
  convertImportedTransactionToManual,
  findUsableCategory,
  findUserTransactionForReview,
  listUserImportedTransactions,
  recategorizeImportedTransaction,
  unlinkImportedTransaction,
  ImportedTransactionRecord,
} from '../services/prismaTransactionService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { recordAuditEvent, AuditActions } from '../services/auditLogService.js';
import { prisma } from '../config/prisma.js';
import {
  ImportedTransactionData,
  ImportedTransactionListData,
  TransactionCategorySummary,
} from '../types/transaction.js';

function toCategorySummary(category: {
  id: string;
  name: string;
  type: TransactionCategorySummary['type'];
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}): TransactionCategorySummary {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    icon: category.icon,
    color: category.color,
    isDefault: category.isDefault,
  };
}

function toImportedTransactionData(tx: ImportedTransactionRecord): ImportedTransactionData {
  const account = tx.financialAccount;
  return {
    id: tx.id,
    amount: Number(tx.amount),
    type: tx.type,
    description: tx.description,
    merchant: tx.merchant,
    transactionDate: tx.transactionDate,
    paymentMethod: tx.paymentMethod,
    paymentChannel: tx.paymentChannel,
    category: toCategorySummary(tx.category),
    financialAccountId: tx.financialAccountId,
    financialAccount: account
      ? {
          id: account.id,
          name: account.name,
          mask: account.mask,
          type: account.type,
          currency: account.currency,
          institutionName: account.institutionName,
        }
      : null,
    source: tx.source,
    externalTransactionId: tx.externalTransactionId,
    importedAt: tx.importedAt,
  };
}

function transactionNotFound(): AppError {
  return new AppError(
    'Transaction not found',
    404,
    undefined,
    ApiErrorCodes.TRANSACTION_NOT_FOUND
  );
}

function notImportedError(action: string): AppError {
  return new AppError(
    `Only imported transactions can be ${action}`,
    400,
    undefined,
    ApiErrorCodes.TRANSACTION_NOT_IMPORTED
  );
}

function categoryNotFound(): AppError {
  return new AppError('Category not found', 404, undefined, ApiErrorCodes.CATEGORY_NOT_FOUND);
}

function typeMatchesCategory(type: string, categoryType: CategoryType): boolean {
  return (type as unknown as CategoryType) === categoryType;
}

async function getReviewableTransactionOrThrow(
  transactionId: string,
  userId: string,
  action: string
): Promise<ImportedTransactionRecord> {
  const transaction = await findUserTransactionForReview(transactionId, userId);
  if (!transaction) {
    throw transactionNotFound();
  }
  if (transaction.source !== TransactionSource.IMPORTED) {
    throw notImportedError(action);
  }
  return transaction;
}

export async function listImportedTransactionsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListImportedTransactionsQuery;

  if (query?.categoryId) {
    const category = await findUsableCategory(query.categoryId, userId);
    if (!category) {
      throw categoryNotFound();
    }
  }

  const { transactions, total, page, limit } = await listUserImportedTransactions(
    userId,
    query
  );

  const data: ImportedTransactionListData = {
    transactions: transactions.map(toImportedTransactionData),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };

  res.json({ success: true, data });
}

export async function recategorizeImportedTransactionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const { categoryId } = req.body as TransactionCategoryInput;

  const existing = await getReviewableTransactionOrThrow(id, userId, 'recategorized');

  const category = await findUsableCategory(categoryId, userId);
  if (!category) {
    throw categoryNotFound();
  }
  if (!typeMatchesCategory(existing.type, category.type)) {
    const message = 'Category type must match the transaction type';
    throw new AppError(
      message,
      400,
      { 'body.categoryId': [message] },
      ApiErrorCodes.VALIDATION_ERROR
    );
  }

  const transaction = await recategorizeImportedTransaction(existing.id, categoryId);

  await recordAuditEvent(
    {
      actorUserId: userId,
      action: AuditActions.IMPORTED_TRANSACTION_RECATEGORIZED,
      entityType: 'transaction',
      entityId: transaction.id,
      metadata: {
        transactionId: transaction.id,
        previousCategoryId: existing.categoryId,
        categoryId: transaction.categoryId,
        financialAccountId: transaction.financialAccountId,
      },
    },
    prisma
  );

  res.json({ success: true, data: { transaction: toImportedTransactionData(transaction) } });
}

export async function unlinkImportedTransactionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await getReviewableTransactionOrThrow(id, userId, 'unlinked');
  const transaction = await unlinkImportedTransaction(existing.id);

  await recordAuditEvent(
    {
      actorUserId: userId,
      action: AuditActions.IMPORTED_TRANSACTION_UNLINKED,
      entityType: 'transaction',
      entityId: transaction.id,
      metadata: {
        transactionId: transaction.id,
        financialAccountId: existing.financialAccountId,
      },
    },
    prisma
  );

  res.json({ success: true, data: { transaction: toImportedTransactionData(transaction) } });
}

export async function convertImportedTransactionToManualHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await getReviewableTransactionOrThrow(id, userId, 'converted to manual');
  const transaction = await convertImportedTransactionToManual(existing.id);

  await recordAuditEvent(
    {
      actorUserId: userId,
      action: AuditActions.IMPORTED_TRANSACTION_CONVERTED_TO_MANUAL,
      entityType: 'transaction',
      entityId: transaction.id,
      metadata: {
        transactionId: transaction.id,
        previousSource: existing.source,
        newSource: transaction.source,
      },
    },
    prisma
  );

  res.json({ success: true, data: { transaction: toImportedTransactionData(transaction) } });
}
