import { Response } from 'express';
import { CategoryType, Prisma } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  CreateBudgetInput,
  ListBudgetsQuery,
  UpdateBudgetInput,
} from '../schemas/budgetSchemas.js';
import {
  BudgetWithCategories,
  createBudget,
  deleteBudget,
  findUserBudget,
  getBudgetProgress,
  listUserBudgets,
  toBudgetCategorySummary,
  updateBudget,
} from '../services/prismaBudgetService.js';
import { findUsableCategory } from '../services/prismaTransactionService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import {
  BudgetData,
  BudgetDataWithProgress,
  BudgetProgressData,
} from '../types/budget.js';
import { toUtcMonthKey } from '../utils/date.js';
import { roundMoney } from '../utils/money.js';

function toBudgetData(budget: BudgetWithCategories): BudgetData {
  const category = budget.budgetCategories[0]?.category ?? null;

  return {
    id: budget.id,
    userId: budget.userId,
    name: budget.name,
    amount: roundMoney(budget.amount),
    month: toUtcMonthKey(budget.month.getUTCFullYear(), budget.month.getUTCMonth()),
    category: category ? toBudgetCategorySummary(category) : null,
    createdAt: budget.createdAt,
    updatedAt: budget.updatedAt,
  };
}

async function toBudgetDataWithProgress(
  budget: BudgetWithCategories
): Promise<BudgetDataWithProgress> {
  const progress = await getBudgetProgress(budget);
  return { ...toBudgetData(budget), progress };
}

async function assertUsableExpenseCategory(categoryId: string, userId: string): Promise<void> {
  const category = await findUsableCategory(categoryId, userId);
  if (!category) {
    throw new AppError('Category not found', 404, undefined, ApiErrorCodes.CATEGORY_NOT_FOUND);
  }
  if (category.type !== CategoryType.EXPENSE) {
    throw AppError.badRequest(
      'Budget category must be an expense category',
      undefined,
      ApiErrorCodes.VALIDATION_ERROR
    );
  }
}

async function findOwnedBudgetOrThrow(id: string, userId: string): Promise<BudgetWithCategories> {
  const budget = await findUserBudget(id, userId);
  if (!budget) {
    throw new AppError('Budget not found', 404, undefined, ApiErrorCodes.BUDGET_NOT_FOUND);
  }
  return budget;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

export async function listBudgetsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListBudgetsQuery;

  const budgets = await listUserBudgets(userId, query);
  const budgetsData = await Promise.all(budgets.map((budget) => toBudgetDataWithProgress(budget)));

  res.json({
    success: true,
    data: { budgets: budgetsData },
  });
}

export async function createBudgetHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateBudgetInput;

  if (input.categoryId) {
    await assertUsableExpenseCategory(input.categoryId, userId);
  }

  let budget: BudgetWithCategories;
  try {
    budget = await createBudget(userId, input);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        'A budget with this name already exists for this month',
        409,
        undefined,
        ApiErrorCodes.BUDGET_ALREADY_EXISTS
      );
    }
    throw error;
  }

  res.status(201).json({
    success: true,
    data: { budget: toBudgetData(budget) },
  });
}

export async function getBudgetHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const budget = await findOwnedBudgetOrThrow(id, userId);
  const budgetData = await toBudgetDataWithProgress(budget);

  res.json({
    success: true,
    data: { budget: budgetData },
  });
}

export async function updateBudgetHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateBudgetInput;

  const existing = await findOwnedBudgetOrThrow(id, userId);

  if (typeof input.categoryId === 'string') {
    await assertUsableExpenseCategory(input.categoryId, userId);
  }

  let budget: BudgetWithCategories;
  try {
    budget = await updateBudget(existing.id, input);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        'A budget with this name already exists for this month',
        409,
        undefined,
        ApiErrorCodes.BUDGET_ALREADY_EXISTS
      );
    }
    throw error;
  }

  res.json({
    success: true,
    data: { budget: toBudgetData(budget) },
  });
}

export async function deleteBudgetHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const budget = await findOwnedBudgetOrThrow(id, userId);

  await deleteBudget(budget.id);

  res.json({
    success: true,
    data: { message: 'Budget deleted' },
  });
}

export async function getBudgetProgressHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const budget = await findOwnedBudgetOrThrow(id, userId);
  const progress: BudgetProgressData = await getBudgetProgress(budget);

  res.json({
    success: true,
    data: { progress },
  });
}
