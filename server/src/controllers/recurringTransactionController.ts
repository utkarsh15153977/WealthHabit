import { Response } from 'express';
import { CategoryType } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  CreateRecurringTransactionInput,
  ListRecurringTransactionsQuery,
  UpdateRecurringTransactionInput,
} from '../schemas/recurringTransactionSchemas.js';
import {
  createRecurringTransaction,
  currentProcessingDate,
  deleteRecurringTransaction,
  findUserRecurringTransaction,
  generateDueOccurrencesForRule,
  generateDueOccurrencesForUser,
  listUserRecurringTransactions,
  updateRecurringTransaction,
} from '../services/prismaRecurringTransactionService.js';
import { findUsableCategory } from '../services/prismaTransactionService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import {
  RecurringTransactionData,
  RecurringTransactionListData,
} from '../types/recurringTransaction.js';
import { TransactionCategorySummary } from '../types/transaction.js';

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

function toRecurringTransactionData(rule: {
  id: string;
  name: string;
  categoryId: string;
  type: RecurringTransactionData['type'];
  amount: unknown;
  frequency: RecurringTransactionData['frequency'];
  startDate: Date;
  endDate: Date | null;
  nextOccurrenceDate: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  category: Parameters<typeof toCategorySummary>[0];
}): RecurringTransactionData {
  return {
    id: rule.id,
    name: rule.name,
    categoryId: rule.categoryId,
    type: rule.type,
    amount: Number(rule.amount),
    frequency: rule.frequency,
    startDate: rule.startDate,
    endDate: rule.endDate,
    nextOccurrenceDate: rule.nextOccurrenceDate,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    category: toCategorySummary(rule.category),
  };
}

function typeMatchesCategory(type: string, categoryType: CategoryType): boolean {
  return (type as unknown as CategoryType) === categoryType;
}

async function assertRecurringCategory(
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
    throw new AppError(
      'Category type must match the recurring transaction type',
      400,
      { 'body.categoryId': ['Category type must match the recurring transaction type'] },
      ApiErrorCodes.VALIDATION_ERROR
    );
  }
}

export async function createRecurringTransactionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateRecurringTransactionInput;

  await assertRecurringCategory(input.categoryId, userId, input.type);

  const rule = await createRecurringTransaction(userId, input);

  res.status(201).json({
    success: true,
    data: { recurringTransaction: toRecurringTransactionData(rule) },
  });
}

export async function listRecurringTransactionsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListRecurringTransactionsQuery;

  const rules = await listUserRecurringTransactions(userId, query);

  const data: RecurringTransactionListData = {
    recurringTransactions: rules.map(toRecurringTransactionData),
  };

  res.json({
    success: true,
    data,
  });
}

export async function getRecurringTransactionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const rule = await findUserRecurringTransaction(id, userId);
  if (!rule) {
    throw new AppError(
      'Recurring transaction not found',
      404,
      undefined,
      ApiErrorCodes.RECURRING_TRANSACTION_NOT_FOUND
    );
  }

  res.json({
    success: true,
    data: { recurringTransaction: toRecurringTransactionData(rule) },
  });
}

export async function updateRecurringTransactionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateRecurringTransactionInput;

  const existing = await findUserRecurringTransaction(id, userId);
  if (!existing) {
    throw new AppError(
      'Recurring transaction not found',
      404,
      undefined,
      ApiErrorCodes.RECURRING_TRANSACTION_NOT_FOUND
    );
  }

  const effectiveType = input.type !== undefined ? input.type : existing.type;

  if (input.categoryId !== undefined) {
    await assertRecurringCategory(input.categoryId, userId, effectiveType);
  } else if (input.type !== undefined && !typeMatchesCategory(effectiveType, existing.category.type)) {
    throw new AppError(
      'Category type must match the recurring transaction type',
      400,
      { 'body.type': ['Category type must match the recurring transaction type'] },
      ApiErrorCodes.VALIDATION_ERROR
    );
  }

  const effectiveStartDate = input.startDate !== undefined ? input.startDate : existing.startDate;
  if (
    input.endDate !== undefined &&
    input.endDate !== null &&
    input.endDate.getTime() < effectiveStartDate.getTime()
  ) {
    throw new AppError(
      'End date must be on or after start date',
      400,
      { 'body.endDate': ['End date must be on or after start date'] },
      ApiErrorCodes.VALIDATION_ERROR
    );
  }

  const rule = await updateRecurringTransaction(existing.id, input);

  res.json({
    success: true,
    data: { recurringTransaction: toRecurringTransactionData(rule) },
  });
}

export async function deleteRecurringTransactionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await findUserRecurringTransaction(id, userId);
  if (!existing) {
    throw new AppError(
      'Recurring transaction not found',
      404,
      undefined,
      ApiErrorCodes.RECURRING_TRANSACTION_NOT_FOUND
    );
  }

  await deleteRecurringTransaction(existing.id);

  res.json({
    success: true,
    data: { message: 'Recurring transaction deleted' },
  });
}

export async function generateOccurrencesHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const result = await generateDueOccurrencesForRule(id, userId, currentProcessingDate());

  if (!result) {
    throw new AppError(
      'Recurring transaction not found',
      404,
      undefined,
      ApiErrorCodes.RECURRING_TRANSACTION_NOT_FOUND
    );
  }

  res.json({
    success: true,
    data: {
      occurrencesCreated: result.occurrencesCreated,
      nextOccurrenceDate: result.nextOccurrenceDate,
    },
  });
}

export async function generateAllOccurrencesHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const summary = await generateDueOccurrencesForUser(userId, currentProcessingDate());

  res.json({
    success: true,
    data: summary,
  });
}
