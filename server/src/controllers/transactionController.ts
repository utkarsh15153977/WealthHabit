import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  CreateTransactionInput,
  ListTransactionsQuery,
  UpdateTransactionInput,
} from '../schemas/transactionSchemas.js';
import {
  createTransaction,
  deleteTransaction,
  findTransactionById,
  findUserTransaction,
  findUsableCategory,
  listUserTransactions,
  updateTransaction,
} from '../services/prismaTransactionService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import {
  TransactionCategorySummary,
  TransactionData,
  TransactionListData,
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

function toTransactionData(tx: {
  id: string;
  categoryId: string;
  type: TransactionData['type'];
  amount: unknown;
  description: string | null;
  transactionDate: Date;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  category: Parameters<typeof toCategorySummary>[0];
}): TransactionData {
  return {
    id: tx.id,
    categoryId: tx.categoryId,
    type: tx.type,
    amount: Number(tx.amount),
    description: tx.description,
    transactionDate: tx.transactionDate,
    paymentMethod: tx.paymentMethod,
    notes: tx.notes,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
    category: toCategorySummary(tx.category),
  };
}

async function assertUsableCategory(categoryId: string, userId: string): Promise<void> {
  const category = await findUsableCategory(categoryId, userId);
  if (!category) {
    throw new AppError(
      'Category not found',
      404,
      undefined,
      ApiErrorCodes.CATEGORY_NOT_FOUND
    );
  }
}

export async function createTransactionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateTransactionInput;

  await assertUsableCategory(input.categoryId, userId);

  const transaction = await createTransaction(userId, input);

  res.status(201).json({
    success: true,
    data: { transaction: toTransactionData(transaction) },
  });
}

export async function listTransactionsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListTransactionsQuery;

  if (query?.categoryId) {
    await assertUsableCategory(query.categoryId, userId);
  }

  const { transactions, total, page, limit } = await listUserTransactions(userId, query);

  const data: TransactionListData = {
    transactions: transactions.map(toTransactionData),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };

  res.json({
    success: true,
    data,
  });
}

export async function getTransactionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const transaction = await findUserTransaction(id, userId);
  if (!transaction) {
    throw new AppError(
      'Transaction not found',
      404,
      undefined,
      ApiErrorCodes.TRANSACTION_NOT_FOUND
    );
  }

  res.json({
    success: true,
    data: { transaction: toTransactionData(transaction) },
  });
}

export async function updateTransactionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateTransactionInput;

  const existing = await findUserTransaction(id, userId);
  if (!existing) {
    throw new AppError(
      'Transaction not found',
      404,
      undefined,
      ApiErrorCodes.TRANSACTION_NOT_FOUND
    );
  }

  if (input.categoryId !== undefined) {
    await assertUsableCategory(input.categoryId, userId);
  }

  const transaction = await updateTransaction(existing.id, input);

  res.json({
    success: true,
    data: { transaction: toTransactionData(transaction) },
  });
}

export async function deleteTransactionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await findUserTransaction(id, userId);
  if (!existing) {
    throw new AppError(
      'Transaction not found',
      404,
      undefined,
      ApiErrorCodes.TRANSACTION_NOT_FOUND
    );
  }

  await deleteTransaction(existing.id);

  res.json({
    success: true,
    data: { message: 'Transaction deleted' },
  });
}

export { findTransactionById };
