import { Response } from 'express';
import { CategoryType, TransactionSource } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  BulkRecategorizeInput,
  CategorizationPreviewInput,
} from '../schemas/transactionSchemas.js';
import { listUserCategories } from '../services/prismaCategoryService.js';
import { findUsableCategory } from '../services/prismaTransactionService.js';
import {
  upsertUserCategoryRule,
} from '../services/prismaTransactionCategoryRuleService.js';
import { categorize } from '../services/categorization/categorizationEngine.js';
import { normalizeMerchant } from '../services/categorization/merchantNormalizer.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { recordAuditEvent, AuditActions } from '../services/auditLogService.js';
import { prisma } from '../config/prisma.js';
import {
  BulkRecategorizeData,
  CategorizationPreviewData,
  TransactionCategorySummary,
} from '../types/transaction.js';

function categoryNotFound(): AppError {
  return new AppError('Category not found', 404, undefined, ApiErrorCodes.CATEGORY_NOT_FOUND);
}

function transactionNotFound(): AppError {
  return new AppError(
    'Transaction not found',
    404,
    undefined,
    ApiErrorCodes.TRANSACTION_NOT_FOUND
  );
}

function typeMismatchError(): AppError {
  const message = 'Category type must match the transaction type';
  return new AppError(message, 400, { 'body.categoryId': [message] }, ApiErrorCodes.VALIDATION_ERROR);
}

function noCategoryAvailable(): AppError {
  return new AppError(
    'No usable category available',
    404,
    undefined,
    ApiErrorCodes.CATEGORY_NOT_FOUND
  );
}

async function loadCategorizationContext(userId: string) {
  const [categories, userRules] = await Promise.all([
    listUserCategories(userId),
    prisma.transactionCategoryRule.findMany({
      where: { userId, isActive: true },
      select: { normalizedMerchant: true, categoryId: true, priority: true },
    }),
  ]);

  return { categories, userRules };
}

function toCategorySummary(category: {
  id: string;
  name: string;
  type: CategoryType;
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

/**
 * Dry run of the categorization engine over a not-yet-existing transaction:
 * same tiers, same rules, same confidence/reason reporting as an import.
 */
export async function previewCategorizationHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CategorizationPreviewInput;

  const context = await loadCategorizationContext(userId);
  const result = categorize(
    { categories: context.categories, userRules: context.userRules },
    {
      type: input.type,
      merchant: input.merchant ?? null,
      description: input.description ?? null,
      paymentChannel: input.paymentChannel ?? null,
      paymentMethod: input.paymentMethod ?? null,
    }
  );

  if (!result) {
    throw noCategoryAvailable();
  }

  const category = context.categories.find((candidate) => candidate.id === result.categoryId);
  if (!category) {
    throw noCategoryAvailable();
  }

  const data: CategorizationPreviewData = {
    category: toCategorySummary(category),
    confidence: result.confidence,
    reason: result.reason,
    matchedRule: result.matchedRule,
  };

  res.json({ success: true, data });
}

/**
 * Applies one category to up to 100 imported transactions. Every row is
 * validated before anything is written, so a rejected request never updates
 * a subset of the list. Optionally remembers the resulting mapping as user
 * rules for each distinct merchant on the affected rows.
 */
export async function bulkRecategorizeImportedTransactionsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as BulkRecategorizeInput;

  const category = await findUsableCategory(input.categoryId, userId);
  if (!category) {
    throw categoryNotFound();
  }

  const transactions = await prisma.transaction.findMany({
    where: { id: { in: input.transactionIds }, userId },
    select: { id: true, type: true, source: true, merchant: true },
  });
  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));

  for (const transactionId of input.transactionIds) {
    const transaction = byId.get(transactionId);
    if (!transaction) {
      throw transactionNotFound();
    }
    if (transaction.source !== TransactionSource.IMPORTED) {
      throw new AppError(
        'Only imported transactions can be recategorized',
        400,
        undefined,
        ApiErrorCodes.TRANSACTION_NOT_IMPORTED
      );
    }
    if (String(transaction.type) !== String(category.type)) {
      throw typeMismatchError();
    }
  }

  await prisma.transaction.updateMany({
    where: { id: { in: input.transactionIds }, userId },
    data: { categoryId: input.categoryId },
  });

  if (input.rememberForMerchant) {
    const merchants = new Set<string>();
    for (const transaction of transactions) {
      const normalizedMerchant = normalizeMerchant(transaction.merchant);
      if (normalizedMerchant) {
        merchants.add(normalizedMerchant);
      }
    }

    for (const normalizedMerchant of merchants) {
      const { rule, created } = await upsertUserCategoryRule(
        userId,
        normalizedMerchant,
        input.categoryId
      );
      await recordAuditEvent(
        {
          actorUserId: userId,
          action: created
            ? AuditActions.TRANSACTION_CATEGORY_RULE_CREATED
            : AuditActions.TRANSACTION_CATEGORY_RULE_UPDATED,
          entityType: 'transaction_category_rule',
          entityId: rule.id,
          metadata: {
            ruleId: rule.id,
            normalizedMerchant: rule.normalizedMerchant,
            categoryId: rule.categoryId,
          },
        },
        prisma
      );
    }
  }

  await recordAuditEvent(
    {
      actorUserId: userId,
      action: AuditActions.TRANSACTION_BULK_RECATEGORIZED,
      entityType: 'transaction',
      entityId: null,
      metadata: {
        transactionCount: transactions.length,
        categoryId: input.categoryId,
      },
    },
    prisma
  );

  const data: BulkRecategorizeData = {
    transactionCount: transactions.length,
    categoryId: input.categoryId,
  };

  res.json({ success: true, data });
}
