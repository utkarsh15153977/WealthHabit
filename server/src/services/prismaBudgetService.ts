import { Prisma, Budget, BudgetCategory, Category, TransactionType } from '@prisma/client';
import { CreateBudgetInput, UpdateBudgetInput, ListBudgetsQuery } from '../schemas/budgetSchemas.js';
import { prisma } from '../config/prisma.js';
import { monthBounds, toUtcMonthKey } from '../utils/date.js';
import { ZERO, roundMoney, roundRate } from '../utils/money.js';
import { BudgetCategorySummary, BudgetProgressData } from '../types/budget.js';

export type BudgetWithCategories = Budget & {
  budgetCategories: (BudgetCategory & { category: Category })[];
};

export function toBudgetCategorySummary(category: Category): BudgetCategorySummary {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    icon: category.icon,
    color: category.color,
    isDefault: category.isDefault,
  };
}

const budgetInclude = {
  budgetCategories: {
    include: { category: true },
  },
} satisfies Prisma.BudgetInclude;

export async function createBudget(
  userId: string,
  input: CreateBudgetInput
): Promise<BudgetWithCategories> {
  return prisma.$transaction(async (tx) => {
    const budget = await tx.budget.create({
      data: {
        userId,
        name: input.name,
        amount: input.amount,
        month: input.month,
      },
    });

    if (input.categoryId) {
      await tx.budgetCategory.create({
        data: {
          budgetId: budget.id,
          categoryId: input.categoryId,
          allocatedAmount: input.amount,
        },
      });
    }

    return tx.budget.findUniqueOrThrow({
      where: { id: budget.id },
      include: budgetInclude,
    });
  });
}

export async function listUserBudgets(
  userId: string,
  query: ListBudgetsQuery
): Promise<BudgetWithCategories[]> {
  const where: Prisma.BudgetWhereInput = { userId };

  if (query?.month) {
    where.month = query.month;
  }

  return prisma.budget.findMany({
    where,
    orderBy: [{ month: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    include: budgetInclude,
  });
}

export async function findUserBudget(
  id: string,
  userId: string
): Promise<BudgetWithCategories | null> {
  return prisma.budget.findFirst({
    where: { id, userId },
    include: budgetInclude,
  });
}

export async function updateBudget(
  id: string,
  input: UpdateBudgetInput
): Promise<BudgetWithCategories> {
  return prisma.$transaction(async (tx) => {
    const data: Prisma.BudgetUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.month !== undefined) data.month = input.month;

    const updated = await tx.budget.update({ where: { id }, data });

    if (input.amount !== undefined) {
      await tx.budgetCategory.updateMany({
        where: { budgetId: id },
        data: { allocatedAmount: updated.amount },
      });
    }

    if (input.categoryId !== undefined) {
      await tx.budgetCategory.deleteMany({ where: { budgetId: id } });
      if (input.categoryId !== null) {
        await tx.budgetCategory.create({
          data: {
            budgetId: id,
            categoryId: input.categoryId,
            allocatedAmount: updated.amount,
          },
        });
      }
    }

    return tx.budget.findUniqueOrThrow({
      where: { id },
      include: budgetInclude,
    });
  });
}

export async function deleteBudget(id: string): Promise<void> {
  await prisma.budget.delete({ where: { id } });
}

export async function getBudgetProgress(
  budget: BudgetWithCategories
): Promise<BudgetProgressData> {
  const monthKey = toUtcMonthKey(budget.month.getUTCFullYear(), budget.month.getUTCMonth());
  const { start, end } = monthBounds(monthKey);

  const categoryIds = budget.budgetCategories.map((allocation) => allocation.categoryId);

  const where: Prisma.TransactionWhereInput = {
    userId: budget.userId,
    type: TransactionType.EXPENSE,
    transactionDate: { gte: start, lt: end },
    ...(categoryIds.length > 0 ? { categoryId: { in: categoryIds } } : {}),
  };

  const aggregate = await prisma.transaction.aggregate({
    where,
    _sum: { amount: true },
    _count: true,
  });

  const spent = aggregate._sum.amount ?? ZERO;
  const remaining = budget.amount.minus(spent);
  const percentageUsed = budget.amount.isZero()
    ? 0
    : roundRate(spent.dividedBy(budget.amount).mul(100));

  const category = budget.budgetCategories[0]?.category ?? null;

  return {
    budgetAmount: roundMoney(budget.amount),
    spent: roundMoney(spent),
    remaining: roundMoney(remaining),
    percentageUsed,
    transactionCount: aggregate._count,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    category: category ? toBudgetCategorySummary(category) : null,
  };
}
