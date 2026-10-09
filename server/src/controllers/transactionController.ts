import { Response } from 'express';
import { CategoryType } from '@prisma/client';
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
  findUserTransaction,
  findUsableCategory,
  listUserTransactions,
  updateTransaction,
} from '../services/prismaTransactionService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { toTransactionData } from '../services/transactionDto.js';
import { TransactionListData } from '../types/transaction.js';

function typeMatchesCategory(type: string, categoryType: CategoryType): boolean {
  return (type as unknown as CategoryType) === categoryType;
}

function categoryTypeMismatchError(field: 'body.categoryId' | 'body.type'): AppError {
  const message = 'Category type must match the transaction type';
  return new AppError(message, 400, { [field]: [message] }, ApiErrorCodes.VALIDATION_ERROR);
}

async function assertUsableCategory(
  categoryId: string,
  userId: string,
  expectedType?: string
): Promise<void> {
  const category = await findUsableCategory(categoryId, userId);
  if (!category) {
    throw new AppError(
      'Category not found',
      404,
      undefined,
      ApiErrorCodes.CATEGORY_NOT_FOUND
    );
  }

  if (expectedType !== undefined && !typeMatchesCategory(expectedType, category.type)) {
    throw categoryTypeMismatchError('body.categoryId');
  }
}

export async function createTransactionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateTransactionInput;

  await assertUsableCategory(input.categoryId, userId, input.type);

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

  const effectiveType = input.type !== undefined ? input.type : existing.type;

  if (input.categoryId !== undefined) {
    await assertUsableCategory(input.categoryId, userId, effectiveType);
  } else if (
    input.type !== undefined &&
    !typeMatchesCategory(effectiveType, existing.category.type)
  ) {
    throw categoryTypeMismatchError('body.type');
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
