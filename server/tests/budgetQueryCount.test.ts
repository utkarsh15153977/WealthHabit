import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { Prisma, Role, AccountStatus, CategoryType, TransactionType } from '@prisma/client';
import { testPrisma, createTestUser } from './setup.js';
import { hashPassword } from '../src/services/authService.js';

const { instrumentedPrisma, loggedQueries } = await vi.hoisted(async () => {
  const { PrismaClient: PrismaClientCtor } = await import('@prisma/client');
  const queries: string[] = [];
  const client = new PrismaClientCtor({
    log: [{ emit: 'event', level: 'query' }],
  });
  client.$on('query', (event: { query: string }) => {
    queries.push(event.query);
  });
  return { instrumentedPrisma: client, loggedQueries: queries };
});

vi.mock('../src/config/prisma.js', () => ({
  prisma: instrumentedPrisma,
}));

import { listUserBudgets } from '../src/services/prismaBudgetService.js';

const SEPT_CATEGORY_COUNT = 4;
const SEPT_EXPENSE_PER_CATEGORY = new Prisma.Decimal('15.50');
const SEPT_TOTAL_EXPENSE = new Prisma.Decimal('62.00');
const SEPT_EXPENSE_COUNT = 8;

function isTransactionAggregateQuery(query: string): boolean {
  const normalized = query.toLowerCase().replace(/\s+/g, ' ');
  if (!normalized.includes('"transactions"')) {
    return false;
  }
  return (
    normalized.includes('sum(') ||
    normalized.includes('group by') ||
    normalized.includes('count(*)')
  );
}

function countTransactionAggregates(): number {
  return loggedQueries.filter(isTransactionAggregateQuery).length;
}

describe('Budget list transaction aggregate query count (DB-001)', () => {
  let userId: string;
  let categoryIds: string[];

  beforeEach(async () => {
    const user = createTestUser();
    const passwordHash = await hashPassword(user.password);
    const created = await testPrisma.user.create({
      data: {
        email: user.email,
        passwordHash,
        firstName: user.firstName,
        lastName: user.lastName,
        role: Role.USER,
        status: AccountStatus.ACTIVE,
      },
    });
    userId = created.id;

    const categories = await Promise.all(
      Array.from({ length: SEPT_CATEGORY_COUNT }, (_, index) =>
        testPrisma.category.create({
          data: {
            userId: created.id,
            name: `Bucket ${index + 1}`,
            type: CategoryType.EXPENSE,
          },
        })
      )
    );
    categoryIds = categories.map((category) => category.id);

    await testPrisma.transaction.createMany({
      data: categoryIds.flatMap((categoryId) => [
        {
          userId: created.id,
          categoryId,
          type: TransactionType.EXPENSE,
          amount: '10.00',
          transactionDate: new Date('2026-09-05T00:00:00.000Z'),
        },
        {
          userId: created.id,
          categoryId,
          type: TransactionType.EXPENSE,
          amount: '5.50',
          transactionDate: new Date('2026-09-20T00:00:00.000Z'),
        },
      ]),
    });

    loggedQueries.length = 0;
  });

  afterAll(async () => {
    await instrumentedPrisma.$disconnect();
  });

  async function seedCategorizedBudgets(month: string, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const categoryId = categoryIds[index % categoryIds.length];
      await testPrisma.budget.create({
        data: {
          userId,
          name: `Budget ${month}-${index}`,
          amount: new Prisma.Decimal('100.00'),
          month: new Date(`${month}-01T00:00:00.000Z`),
          budgetCategories: {
            create: [{ categoryId, allocatedAmount: new Prisma.Decimal('100.00') }],
          },
        },
      });
    }
  }

  async function seedUncategorizedBudget(month: string, name: string): Promise<void> {
    await testPrisma.budget.create({
      data: {
        userId,
        name,
        amount: new Prisma.Decimal('1000.00'),
        month: new Date(`${month}-01T00:00:00.000Z`),
      },
    });
  }

  it('issues a constant number of transaction aggregates for a single month', async () => {
    await seedCategorizedBudgets('2026-09', 2);

    loggedQueries.length = 0;
    const twoBudgets = await listUserBudgets(userId, { pageSize: 50 });
    const twoBudgetCount = countTransactionAggregates();
    expect(twoBudgets.budgets).toHaveLength(2);
    expect(twoBudgets.total).toBe(2);

    await testPrisma.budget.deleteMany({ where: { userId } });
    await seedCategorizedBudgets('2026-09', 8);

    loggedQueries.length = 0;
    const eightBudgets = await listUserBudgets(userId, { pageSize: 50 });
    const eightBudgetCount = countTransactionAggregates();
    expect(eightBudgets.budgets).toHaveLength(8);
    expect(eightBudgets.total).toBe(8);

    expect(twoBudgetCount).toBe(1);
    expect(eightBudgetCount).toBe(twoBudgetCount);
  });

  it('scales transaction aggregates with distinct months, not with budget count', async () => {
    await seedCategorizedBudgets('2026-09', 2);
    await seedCategorizedBudgets('2026-08', 2);

    loggedQueries.length = 0;
    const twoBudgetsPerMonth = await listUserBudgets(userId, { pageSize: 50 });
    const twoPerMonthCount = countTransactionAggregates();
    expect(twoBudgetsPerMonth.budgets).toHaveLength(4);

    await testPrisma.budget.deleteMany({ where: { userId } });
    await seedCategorizedBudgets('2026-09', 4);
    await seedCategorizedBudgets('2026-08', 4);

    loggedQueries.length = 0;
    const fourBudgetsPerMonth = await listUserBudgets(userId, { pageSize: 50 });
    const fourPerMonthCount = countTransactionAggregates();
    expect(fourBudgetsPerMonth.budgets).toHaveLength(8);

    expect(twoPerMonthCount).toBe(2);
    expect(fourPerMonthCount).toBe(twoPerMonthCount);
  });

  it('adds exactly one month aggregate when a page mixes categorized and uncategorized budgets', async () => {
    await seedCategorizedBudgets('2026-09', 1);
    await seedUncategorizedBudget('2026-09', 'Overall September');

    loggedQueries.length = 0;
    const result = await listUserBudgets(userId, { pageSize: 50 });
    const aggregateCount = countTransactionAggregates();

    expect(result.budgets).toHaveLength(2);
    expect(aggregateCount).toBe(2);

    const uncategorized = result.progressByBudget.get(result.budgets[0].id);
    const categorized = result.progressByBudget.get(result.budgets[1].id);

    expect(uncategorized?.spent).toBe(SEPT_TOTAL_EXPENSE.toNumber());
    expect(uncategorized?.transactionCount).toBe(SEPT_EXPENSE_COUNT);
    expect(categorized?.spent).toBe(SEPT_EXPENSE_PER_CATEGORY.toNumber());
    expect(categorized?.transactionCount).toBe(2);
  });

  it('does not grow transaction aggregates when the page holds only uncategorized budgets', async () => {
    await seedUncategorizedBudget('2026-09', 'Overall One');
    await seedUncategorizedBudget('2026-09', 'Overall Two');
    await seedUncategorizedBudget('2026-09', 'Overall Three');

    loggedQueries.length = 0;
    const result = await listUserBudgets(userId, { pageSize: 50 });
    const aggregateCount = countTransactionAggregates();

expect(result.budgets).toHaveLength(3);
    expect(aggregateCount).toBe(1);

    const expectedSpent = SEPT_TOTAL_EXPENSE.toNumber();
    for (const budget of result.budgets) {
      const progress = result.progressByBudget.get(budget.id);
      expect(progress?.spent).toBe(expectedSpent);
      expect(progress?.transactionCount).toBe(SEPT_EXPENSE_COUNT);
    }
  });
});


