import { Response } from 'express';
import { GoalContribution, Prisma, SavingsGoal } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import {
  CreateContributionInput,
  CreateGoalInput,
  ListContributionsQuery,
  ListGoalsQuery,
  UpdateContributionInput,
  UpdateGoalInput,
} from '../schemas/goalSchemas.js';
import {
  createGoal,
  createGoalContribution,
  deleteGoal,
  deleteGoalContribution,
  findGoalContribution,
  findUserGoal,
  getGoalAggregate,
  listGoalContributions,
  listUserGoals,
  updateGoal,
  updateGoalContribution,
  GoalAggregate,
} from '../services/prismaGoalService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { startOfUtcDay } from '../utils/date.js';
import { roundMoney, roundRate, ZERO } from '../utils/money.js';
import {
  GoalContributionData,
  GoalContributionListData,
  GoalData,
  GoalListData,
  GoalProgress,
} from '../types/goal.js';

const HUNDRED = new Prisma.Decimal(100);

const EMPTY_AGGREGATE: GoalAggregate = {
  savedAmount: ZERO,
  contributionCount: 0,
};

function progressValues(saved: Prisma.Decimal, target: Prisma.Decimal): {
  remainingAmount: Prisma.Decimal;
  progressPercent: number;
} {
  const remaining = target.minus(saved);
  const remainingAmount = remaining.isNegative() ? ZERO : remaining;
  let percent = target.lte(ZERO) ? ZERO : saved.div(target).times(HUNDRED);
  if (percent.gt(HUNDRED)) {
    percent = HUNDRED;
  }
  return { remainingAmount, progressPercent: roundRate(percent) };
}

function isOverdue(
  status: SavingsGoal['status'],
  targetDate: Date,
  today: Date
): boolean {
  return (
    status !== 'COMPLETED' &&
    status !== 'CANCELLED' &&
    targetDate.getTime() < today.getTime()
  );
}

function toGoalData(
  goal: SavingsGoal,
  aggregate: GoalAggregate,
  today: Date
): GoalData {
  const { remainingAmount, progressPercent } = progressValues(
    aggregate.savedAmount,
    goal.targetAmount
  );

  return {
    id: goal.id,
    name: goal.name,
    description: goal.description,
    category: goal.category,
    priority: goal.priority,
    status: goal.status,
    targetAmount: roundMoney(goal.targetAmount),
    currentAmount: roundMoney(aggregate.savedAmount),
    remainingAmount: roundMoney(remainingAmount),
    progressPercent,
    contributionCount: aggregate.contributionCount,
    targetDate: goal.targetDate,
    overdue: isOverdue(goal.status, goal.targetDate, today),
    monthlyContribution: goal.monthlyContribution
      ? roundMoney(goal.monthlyContribution)
      : null,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

function toContributionData(
  contribution: GoalContribution
): GoalContributionData {
  return {
    id: contribution.id,
    goalId: contribution.goalId,
    amount: roundMoney(contribution.amount),
    contributionDate: contribution.contributionDate,
    note: contribution.note,
    createdAt: contribution.createdAt,
  };
}

function toGoalProgress(
  goal: SavingsGoal,
  aggregate: GoalAggregate,
  today: Date
): GoalProgress {
  const { remainingAmount, progressPercent } = progressValues(
    aggregate.savedAmount,
    goal.targetAmount
  );

  return {
    goalId: goal.id,
    targetAmount: roundMoney(goal.targetAmount),
    currentAmount: roundMoney(aggregate.savedAmount),
    remainingAmount: roundMoney(remainingAmount),
    progressPercent,
    contributionCount: aggregate.contributionCount,
    targetDate: goal.targetDate,
    status: goal.status,
    overdue: isOverdue(goal.status, goal.targetDate, today),
  };
}

async function findGoalOrThrow(id: string, userId: string): Promise<SavingsGoal> {
  const goal = await findUserGoal(id, userId);
  if (!goal) {
    throw new AppError('Goal not found', 404, undefined, ApiErrorCodes.GOAL_NOT_FOUND);
  }
  return goal;
}

async function findContributionOrThrow(
  contributionId: string,
  goalId: string
): Promise<GoalContribution> {
  const contribution = await findGoalContribution(goalId, contributionId);
  if (!contribution) {
    throw new AppError(
      'Contribution not found',
      404,
      undefined,
      ApiErrorCodes.CONTRIBUTION_NOT_FOUND
    );
  }
  return contribution;
}

export async function createGoalHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const input = req.body as CreateGoalInput;

  const goal = await createGoal(userId, input);
  const today = startOfUtcDay(new Date());

  res.status(201).json({
    success: true,
    data: { goal: toGoalData(goal, EMPTY_AGGREGATE, today) },
  });
}

export async function listGoalsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListGoalsQuery;

  const result = await listUserGoals(userId, query);
  const today = startOfUtcDay(new Date());

  const data: GoalListData = {
    goals: result.rows.map((row) =>
      toGoalData(
        row,
        { savedAmount: row.savedAmount, contributionCount: row.contributionCount },
        today
      )
    ),
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    total: result.total,
    activeCount: result.meta.activeCount,
    totalTargetAmount: roundMoney(result.meta.totalTargetAmount),
    totalSavedAmount: roundMoney(result.meta.totalSavedAmount),
    nearestTargetDate: result.meta.nearestTargetDate,
  };

  res.json({ success: true, data });
}

export async function getGoalHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const goal = await findGoalOrThrow(id, userId);
  const aggregate = await getGoalAggregate(goal.id);
  const today = startOfUtcDay(new Date());

  res.json({
    success: true,
    data: { goal: toGoalData(goal, aggregate, today) },
  });
}

export async function updateGoalHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateGoalInput;

  const existing = await findGoalOrThrow(id, userId);
  const goal = await updateGoal(existing, input);
  const aggregate = await getGoalAggregate(goal.id);
  const today = startOfUtcDay(new Date());

  res.json({
    success: true,
    data: { goal: toGoalData(goal, aggregate, today) },
  });
}

export async function deleteGoalHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await findGoalOrThrow(id, userId);
  await deleteGoal(existing.id);

  res.json({
    success: true,
    data: { message: 'Goal deleted' },
  });
}

export async function getGoalProgressHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const goal = await findGoalOrThrow(id, userId);
  const aggregate = await getGoalAggregate(goal.id);
  const today = startOfUtcDay(new Date());

  res.json({
    success: true,
    data: { progress: toGoalProgress(goal, aggregate, today) },
  });
}

export async function listContributionsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const query = (req.query ?? {}) as ListContributionsQuery;

  const goal = await findGoalOrThrow(id, userId);
  const result = await listGoalContributions(goal.id, query);

  const data: GoalContributionListData = {
    contributions: result.contributions.map(toContributionData),
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    total: result.total,
  };

  res.json({ success: true, data });
}

export async function createContributionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const input = req.body as CreateContributionInput;

  const goal = await findGoalOrThrow(id, userId);
  const contribution = await createGoalContribution(goal, input);

  res.status(201).json({
    success: true,
    data: { contribution: toContributionData(contribution) },
  });
}

export async function updateContributionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id, contributionId } = req.params as {
    id: string;
    contributionId: string;
  };
  const input = req.body as UpdateContributionInput;

  const goal = await findGoalOrThrow(id, userId);
  const existing = await findContributionOrThrow(contributionId, goal.id);
  const contribution = await updateGoalContribution(goal, existing, input);

  res.json({
    success: true,
    data: { contribution: toContributionData(contribution) },
  });
}

export async function deleteContributionHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id, contributionId } = req.params as {
    id: string;
    contributionId: string;
  };

  const goal = await findGoalOrThrow(id, userId);
  const existing = await findContributionOrThrow(contributionId, goal.id);
  await deleteGoalContribution(goal, existing);

  res.json({
    success: true,
    data: { message: 'Contribution deleted' },
  });
}
