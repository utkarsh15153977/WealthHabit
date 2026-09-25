import { FinancialHabit, HabitCompletion, Prisma } from '@prisma/client';
import {
  CreateHabitInput,
  ListHabitCompletionsQuery,
  ListHabitsQuery,
  UpdateHabitInput,
} from '../schemas/habitSchemas.js';
import { prisma } from '../config/prisma.js';
import { startOfUtcDay } from '../utils/date.js';
import { Prisma as PrismaNamespace } from '@prisma/client';
import { roundRate } from '../utils/money.js';
import {
  eligiblePeriodCount,
  habitPeriodAnchor,
  habitPeriodKey,
} from '../utils/habitPeriod.js';
import {
  HabitCompletionData,
  HabitData,
  HabitProgressData,
} from '../types/habit.js';

export function toHabitData(habit: FinancialHabit): HabitData {
  return {
    id: habit.id,
    name: habit.name,
    description: habit.description,
    frequency: habit.frequency as HabitData['frequency'],
    target: habit.target === null ? null : habit.target.toNumber(),
    unit: habit.unit,
    startDate: habit.startDate,
    endDate: habit.endDate,
    isActive: habit.isActive,
    createdAt: habit.createdAt,
    updatedAt: habit.updatedAt,
  };
}

export function toCompletionData(
  completion: HabitCompletion,
  frequency: FinancialHabit['frequency']
): HabitCompletionData {
  return {
    habitId: completion.habitId,
    completionDate: completion.completionDate,
    period: habitPeriodKey(frequency, completion.completionDate),
    completedAt: completion.completedAt,
  };
}

function completionRate(
  frequency: FinancialHabit['frequency'],
  startDate: Date,
  endDate: Date | null,
  totalCompletions: number,
  today: Date
): number {
  const eligible = eligiblePeriodCount(frequency, startDate, endDate, today);
  if (eligible <= 0) {
    return 0;
  }
  const completed = Math.min(totalCompletions, eligible);
  return roundRate(
    new PrismaNamespace.Decimal(completed)
      .dividedBy(eligible)
      .mul(100)
  );
}

export async function createHabit(
  userId: string,
  input: CreateHabitInput
): Promise<FinancialHabit> {
  return prisma.financialHabit.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      frequency: input.frequency,
      target: input.target ?? null,
      unit: input.unit ?? null,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
    },
  });
}

export interface HabitListResult {
  habits: FinancialHabit[];
  page: number;
  pageSize: number;
  total: number;
  progressByHabit: Map<string, HabitProgressData> | null;
}

export async function listUserHabits(
  userId: string,
  query?: ListHabitsQuery
): Promise<HabitListResult> {
  const page = query?.page ?? 1;
  const pageSize = query?.pageSize ?? 20;

  const where: Prisma.FinancialHabitWhereInput = { userId };
  if (query?.active === 'true') {
    where.isActive = true;
  } else if (query?.active === 'false') {
    where.isActive = false;
  }
  if (query?.frequency) {
    where.frequency = query.frequency;
  }

  const [habits, total] = await prisma.$transaction([
    prisma.financialHabit.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.financialHabit.count({ where }),
  ]);

  const includeProgress = query?.includeProgress === 'true';
  const progressByHabit = includeProgress
    ? await computeProgressForHabits(habits)
    : null;

  return { habits, page, pageSize, total, progressByHabit };
}

/**
 * Batch progress for a page of habits: two aggregate queries total
 * (completion counts grouped by habit + current-period completions),
 * so the list endpoint never issues one query per habit.
 */
async function computeProgressForHabits(
  habits: FinancialHabit[]
): Promise<Map<string, HabitProgressData>> {
  const progress = new Map<string, HabitProgressData>();
  if (habits.length === 0) {
    return progress;
  }

  const today = startOfUtcDay(new Date());
  const habitIds = habits.map((habit) => habit.id);

  const [completionCounts, currentCompletions] = await prisma.$transaction([
    prisma.habitCompletion.groupBy({
      by: ['habitId'],
      where: { habitId: { in: habitIds } },
      orderBy: { habitId: 'asc' },
      _count: { _all: true },
    }),
    prisma.habitCompletion.findMany({
      where: {
        OR: habits.map((habit) => ({
          habitId: habit.id,
          completionDate: habitPeriodAnchor(habit.frequency, today),
        })),
      },
      select: { habitId: true },
    }),
  ]);

  const countByHabit = new Map<string, number>();
  for (const entry of completionCounts) {
    const count =
      typeof entry._count === 'object' &&
      typeof entry._count._all === 'number'
        ? entry._count._all
        : 0;
    countByHabit.set(entry.habitId, count);
  }
  const completedHabits = new Set(
    currentCompletions.map((completion) => completion.habitId)
  );

  for (const habit of habits) {
    const total = countByHabit.get(habit.id) ?? 0;
    progress.set(habit.id, {
      habitId: habit.id,
      currentPeriod: {
        completed: completedHabits.has(habit.id),
        period: habitPeriodKey(habit.frequency, today),
      },
      totalCompletions: total,
      completionRate: completionRate(
        habit.frequency,
        habit.startDate,
        habit.endDate,
        total,
        today
      ),
      active: habit.isActive,
    });
  }

  return progress;
}

export async function findUserHabit(
  id: string,
  userId: string
): Promise<FinancialHabit | null> {
  return prisma.financialHabit.findFirst({ where: { id, userId } });
}

export async function updateHabit(
  habit: FinancialHabit,
  input: UpdateHabitInput
): Promise<FinancialHabit> {
  const data: Prisma.FinancialHabitUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) {
    data.description = input.description;
  }
  if (input.frequency !== undefined) data.frequency = input.frequency;
  if (input.target !== undefined) {
    data.target = input.target;
  }
  if (input.unit !== undefined) data.unit = input.unit;
  if (input.startDate !== undefined) data.startDate = input.startDate;
  if (input.endDate !== undefined) data.endDate = input.endDate;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  return prisma.financialHabit.update({
    where: { id: habit.id },
    data,
  });
}

export async function deleteHabit(id: string): Promise<void> {
  await prisma.financialHabit.delete({ where: { id } });
}

/**
 * Completes the habit for the period anchored at `completionDate`.
 * The existing @@unique([habitId, completionDate]) constraint makes this
 * race-safe: a concurrent duplicate hits P2002 and is converted into an
 * idempotent "already completed" result.
 */
export async function completeHabitOccurrence(
  habitId: string,
  completionDate: Date
): Promise<{ completion: HabitCompletion; alreadyCompleted: boolean }> {
  try {
    const completion = await prisma.habitCompletion.create({
      data: { habitId, completionDate },
    });
    return { completion, alreadyCompleted: false };
  } catch (error) {
    if (
      error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await prisma.habitCompletion.findUnique({
        where: {
          habitId_completionDate: { habitId, completionDate },
        },
      });
      if (existing) {
        return { completion: existing, alreadyCompleted: true };
      }
    }
    throw error;
  }
}

export async function uncompleteHabitOccurrence(
  habitId: string,
  completionDate: Date
): Promise<boolean> {
  const result = await prisma.habitCompletion.deleteMany({
    where: { habitId, completionDate },
  });
  return result.count > 0;
}

export interface HabitCompletionListResult {
  completions: HabitCompletion[];
  page: number;
  pageSize: number;
  total: number;
}

export async function listHabitCompletions(
  habitId: string,
  query?: ListHabitCompletionsQuery
): Promise<HabitCompletionListResult> {
  const page = query?.page ?? 1;
  const pageSize = query?.pageSize ?? 30;

  const where: Prisma.HabitCompletionWhereInput = { habitId };

  const [completions, total] = await prisma.$transaction([
    prisma.habitCompletion.findMany({
      where,
      orderBy: { completionDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.habitCompletion.count({ where }),
  ]);

  return { completions, page, pageSize, total };
}

export async function getHabitProgress(
  habit: FinancialHabit
): Promise<HabitProgressData> {
  const today = startOfUtcDay(new Date());
  const anchor = habitPeriodAnchor(habit.frequency, today);

  const [totalCompletions, current] = await prisma.$transaction([
    prisma.habitCompletion.count({ where: { habitId: habit.id } }),
    prisma.habitCompletion.findUnique({
      where: {
        habitId_completionDate: { habitId: habit.id, completionDate: anchor },
      },
      select: { habitId: true },
    }),
  ]);

  return {
    habitId: habit.id,
    currentPeriod: {
      completed: current !== null,
      period: habitPeriodKey(habit.frequency, today),
    },
    totalCompletions,
    completionRate: completionRate(
      habit.frequency,
      habit.startDate,
      habit.endDate,
      totalCompletions,
      today
    ),
    active: habit.isActive,
  };
}
