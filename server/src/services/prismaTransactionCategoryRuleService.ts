import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export type TransactionCategoryRuleRecord = Prisma.TransactionCategoryRuleGetPayload<{
  include: { category: true };
}>;

export interface UserCategoryRuleInput {
  normalizedMerchant: string;
  categoryId: string;
  priority?: number;
  isActive?: boolean;
}

export interface UpsertUserCategoryRuleResult {
  rule: TransactionCategoryRuleRecord;
  created: boolean;
}

const ruleInclude = { include: { category: true } } as const;

export async function listUserCategoryRules(
  userId: string
): Promise<TransactionCategoryRuleRecord[]> {
  return prisma.transactionCategoryRule.findMany({
    where: { userId },
    ...ruleInclude,
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
}

export async function findUserCategoryRule(
  id: string,
  userId: string
): Promise<TransactionCategoryRuleRecord | null> {
  return prisma.transactionCategoryRule.findFirst({
    where: { id, userId },
    ...ruleInclude,
  });
}

export async function findUserCategoryRuleByMerchant(
  userId: string,
  normalizedMerchant: string
): Promise<TransactionCategoryRuleRecord | null> {
  return prisma.transactionCategoryRule.findFirst({
    where: { userId, normalizedMerchant },
    ...ruleInclude,
  });
}

export async function createUserCategoryRule(
  userId: string,
  input: UserCategoryRuleInput
): Promise<TransactionCategoryRuleRecord> {
  return prisma.transactionCategoryRule.create({
    data: {
      userId,
      normalizedMerchant: input.normalizedMerchant,
      categoryId: input.categoryId,
      priority: input.priority ?? 0,
      isActive: input.isActive ?? true,
    },
    ...ruleInclude,
  });
}

export async function updateUserCategoryRule(
  id: string,
  input: {
    normalizedMerchant?: string;
    categoryId?: string;
    priority?: number;
    isActive?: boolean;
  }
): Promise<TransactionCategoryRuleRecord> {
  const data: Prisma.TransactionCategoryRuleUpdateInput = {};
  if (input.normalizedMerchant !== undefined) {
    data.normalizedMerchant = input.normalizedMerchant;
  }
  if (input.categoryId !== undefined) {
    data.category = { connect: { id: input.categoryId } };
  }
  if (input.priority !== undefined) {
    data.priority = input.priority;
  }
  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
  }

  return prisma.transactionCategoryRule.update({
    where: { id },
    data,
    ...ruleInclude,
  });
}

export async function deleteUserCategoryRule(id: string): Promise<void> {
  await prisma.transactionCategoryRule.delete({ where: { id } });
}

/**
 * Creates the rule for a normalized merchant, or repoints the existing rule
 * when the merchant already has one. The (userId, normalizedMerchant) unique
 * constraint makes the operation safe under a create race: the losing insert
 * is retried as an update of the row that won.
 */
export async function upsertUserCategoryRule(
  userId: string,
  normalizedMerchant: string,
  categoryId: string
): Promise<UpsertUserCategoryRuleResult> {
  const existing = await findUserCategoryRuleByMerchant(userId, normalizedMerchant);
  if (existing) {
    const rule = await updateUserCategoryRule(existing.id, { categoryId, isActive: true });
    return { rule, created: false };
  }

  try {
    const rule = await createUserCategoryRule(userId, { normalizedMerchant, categoryId });
    return { rule, created: true };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const raced = await findUserCategoryRuleByMerchant(userId, normalizedMerchant);
      if (raced) {
        const rule = await updateUserCategoryRule(raced.id, { categoryId, isActive: true });
        return { rule, created: false };
      }
    }
    throw error;
  }
}
