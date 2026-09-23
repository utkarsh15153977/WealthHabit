import { PrismaClient, Prisma, TransactionType, CategoryType } from '@prisma/client';
import type { DashboardSummaryQuery } from '../schemas/dashboardSchemas.js';
import type {
  DashboardSpendingCategory,
  DashboardSummaryData,
  DashboardTrendPoint,
} from '../types/dashboard.js';
import type { TransactionData, TransactionCategorySummary } from '../types/transaction.js';

const prisma = new PrismaClient();

const ZERO = new Prisma.Decimal(0);

function toUtcMonthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function currentUtcMonth(): string {
  const now = new Date();
  return toUtcMonthKey(now.getUTCFullYear(), now.getUTCMonth());
}

function parseMonthKey(month: string): { year: number; monthIndex: number } {
  const [year, monthNum] = month.split('-').map(Number);
  return { year, monthIndex: monthNum - 1 };
}

function monthBounds(month: string): { start: Date; end: Date } {
  const { year, monthIndex } = parseMonthKey(month);
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

function listTrendMonths(month: string, count: number): string[] {
  const { year, monthIndex } = parseMonthKey(month);
  const months: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, monthIndex - offset, 1));
    months.push(toUtcMonthKey(date.getUTCFullYear(), date.getUTCMonth()));
  }
  return months;
}

function roundMoney(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(2).toNumber();
}

function roundRate(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(2).toNumber();
}

function calculateSavingsRate(income: Prisma.Decimal, expenses: Prisma.Decimal): number {
  if (income.isZero()) {
    return 0;
  }
  return roundRate(income.minus(expenses).dividedBy(income).mul(100));
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
  category: TransactionCategorySummary;
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
    category: tx.category,
  };
}

async function getPeriodSummary(
  userId: string,
  start: Date,
  end: Date
): Promise<{
  income: Prisma.Decimal;
  expenses: Prisma.Decimal;
  transactionCount: number;
}> {
  const grouped = await prisma.transaction.groupBy({
    by: ['type'],
    where: {
      userId,
      transactionDate: { gte: start, lt: end },
    },
    _sum: { amount: true },
    _count: true,
  });

  let income = ZERO;
  let expenses = ZERO;
  let transactionCount = 0;

  for (const row of grouped) {
    const sum = row._sum.amount ?? ZERO;
    transactionCount += row._count;
    if (row.type === TransactionType.INCOME) {
      income = sum;
    } else {
      expenses = sum;
    }
  }

  return { income, expenses, transactionCount };
}

async function getTrend(
  userId: string,
  trendStart: Date,
  trendEnd: Date,
  monthKeys: string[]
): Promise<DashboardTrendPoint[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      transactionDate: { gte: trendStart, lt: trendEnd },
    },
    select: {
      amount: true,
      type: true,
      transactionDate: true,
    },
  });

  const byMonth = new Map<string, { income: Prisma.Decimal; expenses: Prisma.Decimal }>();
  for (const key of monthKeys) {
    byMonth.set(key, { income: ZERO, expenses: ZERO });
  }

  for (const row of rows) {
    const date = row.transactionDate;
    const key = toUtcMonthKey(date.getUTCFullYear(), date.getUTCMonth());
    const bucket = byMonth.get(key);
    if (!bucket) {
      continue;
    }
    if (row.type === TransactionType.INCOME) {
      bucket.income = bucket.income.plus(row.amount);
    } else {
      bucket.expenses = bucket.expenses.plus(row.amount);
    }
  }

  return monthKeys.map((month) => {
    const bucket = byMonth.get(month);
    return {
      month,
      income: roundMoney(bucket?.income ?? ZERO),
      expenses: roundMoney(bucket?.expenses ?? ZERO),
    };
  });
}

async function getSpendingByCategory(
  userId: string,
  start: Date,
  end: Date,
  totalExpenses: Prisma.Decimal,
  categoryLimit: number
): Promise<DashboardSpendingCategory[]> {
  if (totalExpenses.isZero()) {
    return [];
  }

  const grouped = await prisma.transaction.groupBy({
    by: ['categoryId'],
    where: {
      userId,
      type: TransactionType.EXPENSE,
      transactionDate: { gte: start, lt: end },
    },
    _sum: { amount: true },
  });

  const sorted = grouped
    .filter((row) => row._sum.amount !== null)
    .map((row) => ({
      categoryId: row.categoryId,
      amount: row._sum.amount as Prisma.Decimal,
    }))
    .sort((a, b) => {
      const cmp = b.amount.comparedTo(a.amount);
      if (cmp !== 0) {
        return cmp;
      }
      return a.categoryId.localeCompare(b.categoryId);
    })
    .slice(0, categoryLimit);

  if (sorted.length === 0) {
    return [];
  }

  const categories = await prisma.category.findMany({
    where: {
      id: { in: sorted.map((row) => row.categoryId) },
      OR: [{ userId }, { userId: null }],
    },
    select: {
      id: true,
      name: true,
      type: true,
      icon: true,
      color: true,
      isDefault: true,
    },
  });
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const results: DashboardSpendingCategory[] = [];
  for (const row of sorted) {
    const category = categoryById.get(row.categoryId);
    if (!category) {
      continue;
    }
    results.push({
      categoryId: category.id,
      name: category.name,
      type: 'EXPENSE',
      icon: category.icon,
      color: category.color,
      isDefault: category.isDefault,
      amount: roundMoney(row.amount),
      percentage: roundRate(row.amount.dividedBy(totalExpenses).mul(100)),
    });
  }

  return results;
}

export async function getDashboardSummaryData(
  userId: string,
  query: DashboardSummaryQuery
): Promise<DashboardSummaryData> {
  const month = query.month ?? currentUtcMonth();
  const trendMonths = query.trendMonths ?? 6;
  const recentLimit = query.recentLimit ?? 5;
  const categoryLimit = query.categoryLimit ?? 8;

  const { start, end } = monthBounds(month);
  const trendKeys = listTrendMonths(month, trendMonths);
  const trendStart = monthBounds(trendKeys[0]).start;
  const trendEnd = end;

  const [profile, periodSummary, trend, recent] = await Promise.all([
    prisma.financialProfile.findUnique({ where: { userId } }),
    getPeriodSummary(userId, start, end),
    getTrend(userId, trendStart, trendEnd, trendKeys),
    prisma.transaction.findMany({
      where: { userId },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: recentLimit,
      include: { category: true },
    }),
  ]);

  const { income, expenses, transactionCount } = periodSummary;
  const spendingByCategory = await getSpendingByCategory(
    userId,
    start,
    end,
    expenses,
    categoryLimit
  );
  const savings = income.minus(expenses);
  const savingsRate = calculateSavingsRate(income, expenses);

  const incomeTarget =
    profile?.monthlyIncomeTarget == null ? null : Number(profile.monthlyIncomeTarget);
  const savingsTarget =
    profile?.monthlySavingsTarget == null ? null : Number(profile.monthlySavingsTarget);

  return {
    period: {
      month,
      start: start.toISOString(),
      end: end.toISOString(),
      timezone: 'UTC',
    },
    currency: profile?.currency ?? 'USD',
    summary: {
      income: roundMoney(income),
      expenses: roundMoney(expenses),
      savings: roundMoney(savings),
      savingsRate,
    },
    monthlySummary: {
      month,
      income: roundMoney(income),
      expenses: roundMoney(expenses),
      savings: roundMoney(savings),
      transactionCount,
      incomeTarget,
      savingsTarget,
    },
    targets: {
      monthlyIncomeTarget: incomeTarget,
      monthlySavingsTarget: savingsTarget,
    },
    recentTransactions: recent.map((tx) =>
      toTransactionData({
        id: tx.id,
        categoryId: tx.categoryId,
        type: tx.type,
        amount: tx.amount,
        description: tx.description,
        transactionDate: tx.transactionDate,
        paymentMethod: tx.paymentMethod,
        notes: tx.notes,
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt,
        category: toCategorySummary(tx.category),
      })
    ),
    incomeExpenseTrend: trend,
    spendingByCategory,
  };
}
