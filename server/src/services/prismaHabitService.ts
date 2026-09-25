import { FinancialHabit, HabitCompletion, Prisma } from '@prisma/client';
import {
  CreateHabitInput,
  HabitProgressHistoryQuery,
  ListHabitCompletionsQuery,
  ListHabitsQuery,
  UpdateHabitInput,
} from '../schemas/habitSchemas.js';
import { prisma } from '../config/prisma.js';
import { startOfUtcDay } from '../utils/date.js';
import { Prisma as PrismaNamespace } from '@prisma/client';
import {
  eligiblePeriodBounds,
  habitPeriodKey,
  nextHabitPeriod,
} from '../utils/habitPeriod.js';
import { calculateHabitProgress } from '../utils/habitStreak.js';
import {
  HabitCompletionData,
  HabitData,
  HabitProgressData,
  HabitProgressHistoryItemData,
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

/**
 * Derives the full progress payload (streaks, rate, current period) from
 * one habit's completion anchors. Pure computation — no extra queries.
 */
function buildProgressData(
  habit: FinancialHabit,
  completionAnchors: Date[],
  today: Date
): HabitProgressData {
  const stats = calculateHabitProgress({
    frequency: habit.frequency,
    startDate: habit.startDate,
    endDate: habit.endDate,
    today,
    completionAnchors,
  });

  const currentKey = habitPeriodKey(habit.frequency, today);
  const completedKeys = new Set(
    completionAnchors.map((anchor) => habitPeriodKey(habit.frequency, anchor))
  );

  return {
    habitId: habit.id,
    frequency: habit.frequency as HabitProgressData['frequency'],
    currentPeriod: {
      completed: completedKeys.has(currentKey),
      period: currentKey,
    },
    streak: {
      current: stats.currentStreak,
      longest: stats.longestStreak,
    },
    totalCompletions: stats.totalCompletions,
    eligiblePeriods: stats.eligiblePeriods,
    completionRate: stats.completionRate,
    active: habit.isActive,
  };
}

async function loadCompletionAnchors(
  where: Prisma.HabitCompletionWhereInput
): Promise<{ habitId?: string; completionDate: Date }[]> {
  return prisma.habitCompletion.findMany({
    where,
    select: { habitId: true, completionDate: true },
    orderBy: { completionDate: 'asc' },
  });
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
 * Batch progress for a page of habits: a single completion query for the
 * whole page (habitId + completionDate only, ordered ASC), so the list
 * endpoint never issues one query per habit (no N+1) and streaks are
 * derived in memory from that one result set.
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

  const rows = await loadCompletionAnchors({
    habitId: { in: habitIds },
  });

  const anchorsByHabit = new Map<string, Date[]>();
  for (const row of rows) {
    const existing = anchorsByHabit.get(row.habitId!);
    if (existing) {
      existing.push(row.completionDate);
    } else {
      anchorsByHabit.set(row.habitId!, [row.completionDate]);
    }
  }

  for (const habit of habits) {
    progress.set(
      habit.id,
      buildProgressData(habit, anchorsByHabit.get(habit.id) ?? [], today)
    );
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
  const rows = await loadCompletionAnchors({ habitId: habit.id });
  return buildProgressData(
    habit,
    rows.map((row) => row.completionDate),
    today
  );
}

export interface HabitProgressHistoryResult {
  items: HabitProgressHistoryItemData[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Period-based historical progress: one item per ELIGIBLE occurrence
 * period (daily = day, weekly = Monday, monthly = 1st), newest first.
 * Future periods and periods outside [startDate, endDate] are never
 * synthesized — only the arithmetic eligible window is listed.
 */
export async function getHabitProgressHistory(
  habit: FinancialHabit,
  query?: HabitProgressHistoryQuery
): Promise<HabitProgressHistoryResult> {
  const page = query?.page ?? 1;
  const pageSize = query?.pageSize ?? 12;
  const today = startOfUtcDay(new Date());

  const rows = await loadCompletionAnchors({ habitId: habit.id });
  const completedKeys = new Set(
    rows.map((row) => habitPeriodKey(habit.frequency, row.completionDate))
  );

  const bounds = eligiblePeriodBounds(
    habit.frequency,
    habit.startDate,
    habit.endDate,
    today
  );
  const periods: string[] = [];
  if (bounds !== null) {
    let cursor = bounds.from;
    while (cursor.getTime() <= bounds.to.getTime()) {
      periods.push(habitPeriodKey(habit.frequency, cursor));
      cursor = nextHabitPeriod(cursor, habit.frequency);
    }
    periods.reverse();
  }

  const total = periods.length;
  const start = (page - 1) * pageSize;
  const items = periods.slice(start, start + pageSize).map((period) => ({
    period,
    completed: completedKeys.has(period),
  }));

  return { items, page, pageSize, total };
}
