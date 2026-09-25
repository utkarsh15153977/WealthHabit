import { GoalContribution, GoalStatus, Prisma, SavingsGoal } from '@prisma/client';
import {
  CreateContributionInput,
  CreateGoalInput,
  ListContributionsQuery,
  ListGoalsQuery,
  UpdateContributionInput,
  UpdateGoalInput,
} from '../schemas/goalSchemas.js';
import { prisma } from '../config/prisma.js';
import { startOfUtcDay } from '../utils/date.js';
import { ZERO } from '../utils/money.js';

export interface GoalListMeta {
  total: number;
  activeCount: number;
  totalTargetAmount: Prisma.Decimal;
  totalSavedAmount: Prisma.Decimal;
  nearestTargetDate: Date | null;
}

export interface GoalListRow extends SavingsGoal {
  savedAmount: Prisma.Decimal;
  contributionCount: number;
}

export interface GoalAggregate {
  savedAmount: Prisma.Decimal;
  contributionCount: number;
}

export interface GoalListResult {
  rows: GoalListRow[];
  total: number;
  meta: GoalListMeta;
}

export interface ContributionListResult {
  contributions: GoalContribution[];
  total: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_LIST_PAGE_SIZE = 50;

function deriveGoalStatus(
  intent: GoalStatus,
  savedAmount: Prisma.Decimal,
  targetAmount: Prisma.Decimal
): GoalStatus {
  if (intent === 'PAUSED' || intent === 'CANCELLED') {
    return intent;
  }
  return savedAmount.gte(targetAmount) ? 'COMPLETED' : 'ACTIVE';
}

export async function getGoalAggregate(goalId: string): Promise<GoalAggregate> {
  const aggregate = await prisma.goalContribution.aggregate({
    where: { goalId },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    savedAmount: aggregate._sum.amount ?? ZERO,
    contributionCount: aggregate._count._all,
  };
}

export async function createGoal(
  userId: string,
  input: CreateGoalInput
): Promise<SavingsGoal> {
  return prisma.savingsGoal.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      targetAmount: input.targetAmount,
      targetDate: input.targetDate,
      category: input.category ?? 'general',
      priority: input.priority ?? 'MEDIUM',
      monthlyContribution: input.monthlyContribution ?? null,
      status: 'ACTIVE',
    },
  });
}

/**
 * Flat query plan (no N+1):
 * 1. count over the filtered set -> total
 * 2. aggregate over the filtered set -> totalTargetAmount
 * 3. aggregate over the filtered ACTIVE subset -> activeCount + nearest target date
 * 4. groupBy goalId over contributions of filtered goals -> saved amounts + counts
 * 5. paginated goal rows for the page itself
 *
 * The stored savings_goals.currentAmount column is intentionally never read or
 * written here: contributions are the single source of truth.
 */
export async function listUserGoals(
  userId: string,
  query?: ListGoalsQuery
): Promise<GoalListResult> {
  const page = query?.page ?? 1;
  const pageSize = Math.min(query?.pageSize ?? DEFAULT_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
  const skip = (page - 1) * pageSize;

  const where: Prisma.SavingsGoalWhereInput = { userId };
  if (query?.status) {
    where.status = query.status;
  }
  const activeWhere: Prisma.SavingsGoalWhereInput = { ...where, status: 'ACTIVE' };

  const [total, targetAggregate, activeAggregate, contributionGroups, goals] =
    await Promise.all([
      prisma.savingsGoal.count({ where }),
      prisma.savingsGoal.aggregate({
        where,
        _sum: { targetAmount: true },
      }),
      prisma.savingsGoal.aggregate({
        where: activeWhere,
        _count: { _all: true },
        _min: { targetDate: true },
      }),
      prisma.goalContribution.groupBy({
        by: ['goalId'],
        where: { goal: where },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.savingsGoal.findMany({
        where,
        orderBy: [{ targetDate: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
    ]);

  const savedByGoal = new Map<string, { amount: Prisma.Decimal; count: number }>();
  let totalSaved = ZERO;
  for (const group of contributionGroups) {
    const amount = group._sum.amount ?? ZERO;
    totalSaved = totalSaved.plus(amount);
    savedByGoal.set(group.goalId, {
      amount,
      count: group._count._all,
    });
  }

  const rows = goals.map((goal) => {
    const saved = savedByGoal.get(goal.id);
    return {
      ...goal,
      savedAmount: saved?.amount ?? ZERO,
      contributionCount: saved?.count ?? 0,
    };
  });

  const meta: GoalListMeta = {
    total,
    activeCount: activeAggregate._count._all,
    totalTargetAmount: targetAggregate._sum.targetAmount ?? ZERO,
    totalSavedAmount: totalSaved,
    nearestTargetDate: activeAggregate._min.targetDate,
  };

  return { rows, total, meta };
}

export async function findUserGoal(
  id: string,
  userId: string
): Promise<SavingsGoal | null> {
  return prisma.savingsGoal.findFirst({
    where: { id, userId },
  });
}

export async function updateGoal(
  goal: SavingsGoal,
  input: UpdateGoalInput
): Promise<SavingsGoal> {
  const data: Prisma.SavingsGoalUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.targetAmount !== undefined) data.targetAmount = input.targetAmount;
  if (input.targetDate !== undefined) data.targetDate = input.targetDate;
  if (input.category !== undefined) data.category = input.category;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.monthlyContribution !== undefined) {
    data.monthlyContribution = input.monthlyContribution;
  }

  const intent = input.status ?? goal.status;
  const nextTarget =
    input.targetAmount !== undefined
      ? new Prisma.Decimal(input.targetAmount)
      : goal.targetAmount;

  // Completion is amount-based: recompute against the fresh contribution sum
  // whenever intent or target may have changed.
  const { savedAmount } = await getGoalAggregate(goal.id);
  const nextStatus = deriveGoalStatus(intent, savedAmount, nextTarget);
  data.status = nextStatus;

  return prisma.savingsGoal.update({
    where: { id: goal.id },
    data,
  });
}

export async function deleteGoal(goalId: string): Promise<void> {
  // Cascades goal_contributions via the existing FK; touches no other tables.
  await prisma.savingsGoal.delete({ where: { id: goalId } });
}

export async function listGoalContributions(
  goalId: string,
  query?: ListContributionsQuery
): Promise<ContributionListResult> {
  const page = query?.page ?? 1;
  const pageSize = Math.min(query?.pageSize ?? DEFAULT_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
  const where: Prisma.GoalContributionWhereInput = { goalId };

  const [total, contributions] = await Promise.all([
    prisma.goalContribution.count({ where }),
    prisma.goalContribution.findMany({
      where,
      orderBy: [
        { contributionDate: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { contributions, total };
}

export async function findGoalContribution(
  goalId: string,
  contributionId: string
): Promise<GoalContribution | null> {
  return prisma.goalContribution.findFirst({
    where: { id: contributionId, goalId },
  });
}

/**
 * Serializes mutations per goal row so concurrent contribution writes cannot
 * compute a stale status, re-reads the goal under the lock, then recomputes
 * status from the contribution sum. PAUSED/CANCELLED intents are never
 * overwritten.
 */
async function withGoalLock<T>(
  goal: Pick<SavingsGoal, 'id'>,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "savings_goals" WHERE "id" = ${goal.id} FOR UPDATE`;
    const result = await fn(tx);

    const fresh = await tx.savingsGoal.findUnique({
      where: { id: goal.id },
      select: { id: true, status: true, targetAmount: true },
    });

    if (fresh && fresh.status !== 'PAUSED' && fresh.status !== 'CANCELLED') {
      const aggregate = await tx.goalContribution.aggregate({
        where: { goalId: goal.id },
        _sum: { amount: true },
      });
      const saved = aggregate._sum.amount ?? ZERO;
      const nextStatus = deriveGoalStatus(fresh.status, saved, fresh.targetAmount);
      if (nextStatus !== fresh.status) {
        await tx.savingsGoal.update({
          where: { id: goal.id },
          data: { status: nextStatus },
        });
      }
    }

    return result;
  });
}

export async function createGoalContribution(
  goal: SavingsGoal,
  input: CreateContributionInput
): Promise<GoalContribution> {
  const contributionDate = input.contributionDate ?? startOfUtcDay(new Date());

  return withGoalLock(goal, (tx) =>
    tx.goalContribution.create({
      data: {
        goalId: goal.id,
        amount: input.amount,
        contributionDate,
        note: input.note ?? null,
      },
    })
  );
}

export async function updateGoalContribution(
  goal: SavingsGoal,
  contribution: GoalContribution,
  input: UpdateContributionInput
): Promise<GoalContribution> {
  return withGoalLock(goal, (tx) => {
    const data: Prisma.GoalContributionUpdateInput = {};
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.contributionDate !== undefined) {
      data.contributionDate = input.contributionDate;
    }
    if (input.note !== undefined) data.note = input.note;

    return tx.goalContribution.update({
      where: { id: contribution.id },
      data,
    });
  });
}

export async function deleteGoalContribution(
  goal: SavingsGoal,
  contribution: GoalContribution
): Promise<void> {
  await withGoalLock(goal, async (tx) => {
    await tx.goalContribution.delete({ where: { id: contribution.id } });
  });
}
