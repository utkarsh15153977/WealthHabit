import { Prisma, Budget, BudgetCategory, Category, TransactionType } from '@prisma/client';
import { CreateBudgetInput, UpdateBudgetInput, ListBudgetsQuery } from '../schemas/budgetSchemas.js';
import { prisma } from '../config/prisma.js';
import { monthBounds, toUtcMonthKey } from '../utils/date.js';
import { ZERO, roundMoney, roundRate } from '../utils/money.js';
import { BudgetCategorySummary, BudgetProgressData } from '../types/budget.js';

export type BudgetWithCategories = Budget & {
  budgetCategories: (BudgetCategory & { category: Category })[];
};

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_LIST_PAGE_SIZE = 50;

export interface BudgetListResult {
  budgets: BudgetWithCategories[];
  page: number;
  pageSize: number;
  total: number;
  progressByBudget: Map<string, BudgetProgressData>;
}

interface SpendingTotals {
  spent: Prisma.Decimal;
  count: number;
}

interface MonthSpending {
  byCategory: Map<string, SpendingTotals>;
  overall: SpendingTotals;
}

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
): Promise<BudgetListResult> {
  const where: Prisma.BudgetWhereInput = { userId };

  if (query?.month) {
    where.month = query.month;
  }

  const page = query?.page ?? 1;
  const pageSize = Math.min(query?.pageSize ?? DEFAULT_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
  const skip = (page - 1) * pageSize;

  const [budgets, total] = await prisma.$transaction([
    prisma.budget.findMany({
      where,
      orderBy: [{ month: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: budgetInclude,
      skip,
      take: pageSize,
    }),
    prisma.budget.count({ where }),
  ]);

  const progressByBudget = await computeProgressForBudgets(budgets);

  return { budgets, page, pageSize, total, progressByBudget };
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

  return buildBudgetProgressData(
    budget,
    aggregate._sum.amount ?? ZERO,
    aggregate._count,
    start,
    end
  );
}

export function buildBudgetProgressData(
  budget: BudgetWithCategories,
  spent: Prisma.Decimal,
  transactionCount: number,
  periodStart: Date,
  periodEnd: Date
): BudgetProgressData {
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
    transactionCount,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    category: category ? toBudgetCategorySummary(category) : null,
  };
}

export async function computeProgressForBudgets(
  budgets: BudgetWithCategories[]
): Promise<Map<string, BudgetProgressData>> {
  const progressByBudget = new Map<string, BudgetProgressData>();

  if (budgets.length === 0) {
    return progressByBudget;
  }

  const budgetsByMonth = new Map<string, BudgetWithCategories[]>();

  for (const budget of budgets) {
    const monthKey = toUtcMonthKey(budget.month.getUTCFullYear(), budget.month.getUTCMonth());
    const existing = budgetsByMonth.get(monthKey);
    if (existing) {
      existing.push(budget);
    } else {
      budgetsByMonth.set(monthKey, [budget]);
    }
  }

  for (const [monthKey, monthBudgets] of budgetsByMonth) {
    const { start, end } = monthBounds(monthKey);
    const spending = await loadMonthSpending(monthBudgets, start, end);

    for (const budget of monthBudgets) {
      const totals = resolveBudgetSpending(budget, spending);
      progressByBudget.set(
        budget.id,
        buildBudgetProgressData(budget, totals.spent, totals.count, start, end)
      );
    }
  }

  return progressByBudget;
}

async function loadMonthSpending(
  monthBudgets: BudgetWithCategories[],
  start: Date,
  end: Date
): Promise<MonthSpending> {
  const where: Prisma.TransactionWhereInput = {
    userId: monthBudgets[0].userId,
    type: TransactionType.EXPENSE,
    transactionDate: { gte: start, lt: end },
  };

  const needsCategoryTotals = monthBudgets.some(
    (budget) => budget.budgetCategories.length > 0
  );
  const needsOverallTotals = monthBudgets.some(
    (budget) => budget.budgetCategories.length === 0
  );

  const byCategory = new Map<string, SpendingTotals>();
  let overall: SpendingTotals = { spent: ZERO, count: 0 };

  if (needsCategoryTotals) {
    const groups = await prisma.transaction.groupBy({
      by: ['categoryId'],
      where,
      _sum: { amount: true },
      _count: true,
    });

    for (const group of groups) {
      byCategory.set(group.categoryId, {
        spent: group._sum.amount ?? ZERO,
        count: group._count,
      });
    }
  }

  if (needsOverallTotals) {
    const aggregate = await prisma.transaction.aggregate({
      where,
      _sum: { amount: true },
      _count: true,
    });

    overall = { spent: aggregate._sum.amount ?? ZERO, count: aggregate._count };
  }

  return { byCategory, overall };
}

function resolveBudgetSpending(
  budget: BudgetWithCategories,
  spending: MonthSpending
): SpendingTotals {
  const categoryIds = budget.budgetCategories.map((allocation) => allocation.categoryId);

  if (categoryIds.length === 0) {
    return spending.overall;
  }

  let spent = ZERO;
  let count = 0;

  for (const categoryId of categoryIds) {
    const totals = spending.byCategory.get(categoryId);
    if (!totals) continue;
    spent = spent.plus(totals.spent);
    count += totals.count;
  }

  return { spent, count };
}
