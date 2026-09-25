import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import { startOfUtcDay } from '../utils/date.js';
import {
  CompleteHabitData,
  HabitCompletionListData,
  HabitListData,
  HabitListItem,
  HabitResponse,
  UncompleteHabitData,
} from '../types/habit.js';
import {
  CreateHabitInput,
  HabitProgressHistoryQuery,
  ListHabitCompletionsQuery,
  ListHabitsQuery,
  UpdateHabitInput,
} from '../schemas/habitSchemas.js';
import {
  completeHabitOccurrence,
  createHabit,
  deleteHabit,
  findUserHabit,
  getHabitProgress,
  getHabitProgressHistory,
  listHabitCompletions,
  listUserHabits,
  toCompletionData,
  toHabitData,
  uncompleteHabitOccurrence,
  updateHabit,
} from '../services/prismaHabitService.js';
import { habitPeriodAnchor, isHabitActiveOn } from '../utils/habitPeriod.js';

async function requireHabit(id: string, userId: string) {
  const habit = await findUserHabit(id, userId);
  if (!habit) {
    throw new AppError(
      'Habit not found',
      404,
      undefined,
      ApiErrorCodes.HABIT_NOT_FOUND
    );
  }
  return habit;
}

export async function listHabitsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListHabitsQuery;
  const result = await listUserHabits(userId, query);

  const habits: HabitListItem[] = result.habits.map((habit) => {
    const item: HabitListItem = { ...toHabitData(habit) };
    const progress = result.progressByHabit?.get(habit.id);
    if (progress !== undefined) {
      item.progress = progress;
    }
    return item;
  });

  const data: HabitListData = {
    habits,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  };

  res.json({ success: true, data });
}

export async function createHabitHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const body = req.body as CreateHabitInput;
  const habit = await createHabit(userId, body);

  const data: HabitResponse = { habit: toHabitData(habit) };
  res.status(201).json({ success: true, data });
}

export async function getHabitHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const habit = await requireHabit(id, userId);

  const data: HabitResponse = { habit: toHabitData(habit) };
  res.json({ success: true, data });
}

export async function updateHabitHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const habit = await requireHabit(id, userId);

  const body = req.body as UpdateHabitInput;
  const startDate = body.startDate ?? habit.startDate;
  if (
    body.endDate !== undefined &&
    body.endDate !== null &&
    body.endDate.getTime() < startDate.getTime()
  ) {
    throw new AppError('End date must be on or after start date', 400, {
      'body.endDate': ['End date must be on or after start date'],
    });
  }

  const updated = await updateHabit(habit, body);
  const data: HabitResponse = { habit: toHabitData(updated) };
  res.json({ success: true, data });
}

export async function deleteHabitHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const habit = await requireHabit(id, userId);

  await deleteHabit(habit.id);
  res.json({ success: true, data: { message: 'Habit deleted' } });
}

export async function completeHabitHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const habit = await requireHabit(id, userId);

  if (!habit.isActive) {
    throw new AppError(
      'Habit is no longer active',
      400,
      undefined,
      ApiErrorCodes.HABIT_INACTIVE
    );
  }

  const today = startOfUtcDay(new Date());
  if (!isHabitActiveOn(habit, today)) {
    throw new AppError(
      'Habit is not active for the current period',
      400,
      undefined,
      ApiErrorCodes.HABIT_INVALID_DATE_RANGE
    );
  }

  const anchor = habitPeriodAnchor(habit.frequency, today);
  const { completion, alreadyCompleted } = await completeHabitOccurrence(
    habit.id,
    anchor
  );

  const data: CompleteHabitData = {
    completion: toCompletionData(completion, habit.frequency),
    alreadyCompleted,
  };
  res.status(alreadyCompleted ? 200 : 201).json({ success: true, data });
}

export async function uncompleteHabitHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const habit = await requireHabit(id, userId);

  const today = startOfUtcDay(new Date());
  const anchor = habitPeriodAnchor(habit.frequency, today);
  const removed = await uncompleteHabitOccurrence(habit.id, anchor);

  const data: UncompleteHabitData = { removed };
  res.json({ success: true, data });
}

export async function listCompletionsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const habit = await requireHabit(id, userId);

  const query = (req.query ?? {}) as ListHabitCompletionsQuery;
  const result = await listHabitCompletions(habit.id, query);

  const data: HabitCompletionListData = {
    completions: result.completions.map((completion) =>
      toCompletionData(completion, habit.frequency)
    ),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  };

  res.json({ success: true, data });
}

export async function getHabitProgressHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const habit = await requireHabit(id, userId);

  const progress = await getHabitProgress(habit);
  res.json({ success: true, data: progress });
}

export async function getHabitProgressHistoryHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };
  const habit = await requireHabit(id, userId);

  const query = (req.query ?? {}) as HabitProgressHistoryQuery;
  const result = await getHabitProgressHistory(habit, query);
  res.json({ success: true, data: result });
}
