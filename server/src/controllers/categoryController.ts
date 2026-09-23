import { Response } from 'express';
import { CategoryType } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from '../schemas/categorySchemas.js';
import {
  createCategory,
  deleteCategory,
  findCategoryById,
  findDuplicateCategory,
  isOwnCategory,
  isSystemCategory,
  listUserCategories,
  countCategoryTransactions,
  updateCategory,
} from '../services/prismaCategoryService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { CategoryData, CategoryListData } from '../types/category.js';

function toCategoryData(category: {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CategoryData {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    icon: category.icon,
    color: category.color,
    isDefault: category.isDefault,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

export async function listCategories(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListCategoriesQuery;
  const type = query?.type as CategoryType | undefined;

  const categories = await listUserCategories(userId, type);

  const data: CategoryListData = {
    categories: categories.map(toCategoryData),
  };

  res.json({
    success: true,
    data,
  });
}

export async function createCategoryHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateCategoryInput;

  const duplicate = await findDuplicateCategory(userId, input.name);
  if (duplicate) {
    throw new AppError(
      'A category with this name already exists',
      409,
      undefined,
      ApiErrorCodes.CATEGORY_ALREADY_EXISTS
    );
  }

  const category = await createCategory(userId, input);

  res.status(201).json({
    success: true,
    data: { category: toCategoryData(category) },
  });
}

export async function updateCategoryHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateCategoryInput;

  const category = await findCategoryById(id);
  if (!category) {
    throw new AppError(
      'Category not found',
      404,
      undefined,
      ApiErrorCodes.CATEGORY_NOT_FOUND
    );
  }

  if (isSystemCategory(category)) {
    throw new AppError(
      'System categories cannot be modified',
      403,
      undefined,
      ApiErrorCodes.FORBIDDEN
    );
  }

  if (!isOwnCategory(category, userId)) {
    throw new AppError(
      'Category not found',
      404,
      undefined,
      ApiErrorCodes.CATEGORY_NOT_FOUND
    );
  }

  if (input.name !== undefined && input.name !== category.name) {
    const duplicate = await findDuplicateCategory(userId, input.name);
    if (duplicate && duplicate.id !== category.id) {
      throw new AppError(
        'A category with this name already exists',
        409,
        undefined,
        ApiErrorCodes.CATEGORY_ALREADY_EXISTS
      );
    }
  }

  const updated = await updateCategory(category.id, input);

  res.json({
    success: true,
    data: { category: toCategoryData(updated) },
  });
}

export async function deleteCategoryHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const category = await findCategoryById(id);
  if (!category) {
    throw new AppError(
      'Category not found',
      404,
      undefined,
      ApiErrorCodes.CATEGORY_NOT_FOUND
    );
  }

  if (isSystemCategory(category)) {
    throw new AppError(
      'System categories cannot be deleted',
      403,
      undefined,
      ApiErrorCodes.FORBIDDEN
    );
  }

  if (!isOwnCategory(category, userId)) {
    throw new AppError(
      'Category not found',
      404,
      undefined,
      ApiErrorCodes.CATEGORY_NOT_FOUND
    );
  }

  const transactionCount = await countCategoryTransactions(category.id);
  if (transactionCount > 0) {
    throw new AppError(
      'Cannot delete category that is used by transactions',
      409,
      undefined,
      ApiErrorCodes.CATEGORY_IN_USE
    );
  }

  try {
    await deleteCategory(category.id);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2003'
    ) {
      throw new AppError(
        'Cannot delete category that is used by transactions',
        409,
        undefined,
        ApiErrorCodes.CATEGORY_IN_USE
      );
    }
    throw error;
  }

  res.json({
    success: true,
    data: { message: 'Category deleted' },
  });
}
