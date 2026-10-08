import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  CreateTransactionCategoryRuleInput,
  UpdateTransactionCategoryRuleInput,
} from '../schemas/transactionCategoryRuleSchemas.js';
import {
  createUserCategoryRule,
  deleteUserCategoryRule,
  findUserCategoryRule,
  findUserCategoryRuleByMerchant,
  listUserCategoryRules,
  updateUserCategoryRule,
  TransactionCategoryRuleRecord,
} from '../services/prismaTransactionCategoryRuleService.js';
import { findUsableCategory } from '../services/prismaTransactionService.js';
import { normalizeMerchant } from '../services/categorization/merchantNormalizer.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { recordAuditEvent, AuditActions } from '../services/auditLogService.js';
import { prisma } from '../config/prisma.js';
import {
  TransactionCategoryRuleData,
  TransactionCategoryRuleListData,
  TransactionCategoryRuleCategorySummary,
} from '../types/transactionCategoryRule.js';

function toRuleData(rule: TransactionCategoryRuleRecord): TransactionCategoryRuleData {
  const category: TransactionCategoryRuleCategorySummary = {
    id: rule.category.id,
    name: rule.category.name,
    type: rule.category.type,
    icon: rule.category.icon,
    color: rule.category.color,
    isDefault: rule.category.isDefault,
  };

  return {
    id: rule.id,
    merchant: rule.normalizedMerchant,
    categoryId: rule.categoryId,
    category,
    priority: rule.priority,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function ruleNotFound(): AppError {
  return new AppError(
    'Transaction category rule not found',
    404,
    undefined,
    ApiErrorCodes.CATEGORY_RULE_NOT_FOUND
  );
}

function ruleAlreadyExists(): AppError {
  return new AppError(
    'A rule for this merchant already exists',
    409,
    undefined,
    ApiErrorCodes.CATEGORY_RULE_ALREADY_EXISTS
  );
}

function categoryNotFound(): AppError {
  return new AppError('Category not found', 404, undefined, ApiErrorCodes.CATEGORY_NOT_FOUND);
}

function invalidMerchant(field: string): AppError {
  const message = 'Merchant must contain letters or numbers';
  return new AppError(message, 400, { [field]: [message] }, ApiErrorCodes.VALIDATION_ERROR);
}

function ruleAuditMetadata(rule: TransactionCategoryRuleRecord) {
  return {
    ruleId: rule.id,
    normalizedMerchant: rule.normalizedMerchant,
    categoryId: rule.categoryId,
  };
}

export async function listTransactionCategoryRulesHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const rules = await listUserCategoryRules(userId);

  const data: TransactionCategoryRuleListData = { rules: rules.map(toRuleData) };
  res.json({ success: true, data });
}

export async function createTransactionCategoryRuleHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateTransactionCategoryRuleInput;

  const normalizedMerchant = normalizeMerchant(input.merchant);
  if (!normalizedMerchant) {
    throw invalidMerchant('body.merchant');
  }

  const category = await findUsableCategory(input.categoryId, userId);
  if (!category) {
    throw categoryNotFound();
  }

  const duplicate = await findUserCategoryRuleByMerchant(userId, normalizedMerchant);
  if (duplicate) {
    throw ruleAlreadyExists();
  }

  const rule = await createUserCategoryRule(userId, {
    normalizedMerchant,
    categoryId: input.categoryId,
    priority: input.priority,
    isActive: input.isActive,
  });

  await recordAuditEvent(
    {
      actorUserId: userId,
      action: AuditActions.TRANSACTION_CATEGORY_RULE_CREATED,
      entityType: 'transaction_category_rule',
      entityId: rule.id,
      metadata: ruleAuditMetadata(rule),
    },
    prisma
  );

  res.status(201).json({ success: true, data: { rule: toRuleData(rule) } });
}

export async function updateTransactionCategoryRuleHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateTransactionCategoryRuleInput;

  const existing = await findUserCategoryRule(id, userId);
  if (!existing) {
    throw ruleNotFound();
  }

  let normalizedMerchant = existing.normalizedMerchant;
  if (input.merchant !== undefined) {
    const normalized = normalizeMerchant(input.merchant);
    if (!normalized) {
      throw invalidMerchant('body.merchant');
    }
    if (normalized !== existing.normalizedMerchant) {
      const duplicate = await findUserCategoryRuleByMerchant(userId, normalized);
      if (duplicate && duplicate.id !== existing.id) {
        throw ruleAlreadyExists();
      }
    }
    normalizedMerchant = normalized;
  }

  if (input.categoryId !== undefined) {
    const category = await findUsableCategory(input.categoryId, userId);
    if (!category) {
      throw categoryNotFound();
    }
  }

  const rule = await updateUserCategoryRule(existing.id, {
    normalizedMerchant:
      input.merchant !== undefined ? normalizedMerchant : undefined,
    categoryId: input.categoryId,
    priority: input.priority,
    isActive: input.isActive,
  });

  await recordAuditEvent(
    {
      actorUserId: userId,
      action: AuditActions.TRANSACTION_CATEGORY_RULE_UPDATED,
      entityType: 'transaction_category_rule',
      entityId: rule.id,
      metadata: ruleAuditMetadata(rule),
    },
    prisma
  );

  res.json({ success: true, data: { rule: toRuleData(rule) } });
}

export async function deleteTransactionCategoryRuleHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await findUserCategoryRule(id, userId);
  if (!existing) {
    throw ruleNotFound();
  }

  await deleteUserCategoryRule(existing.id);

  await recordAuditEvent(
    {
      actorUserId: userId,
      action: AuditActions.TRANSACTION_CATEGORY_RULE_DELETED,
      entityType: 'transaction_category_rule',
      entityId: existing.id,
      metadata: ruleAuditMetadata(existing),
    },
    prisma
  );

  res.json({ success: true, data: { ruleId: existing.id, deleted: true } });
}
