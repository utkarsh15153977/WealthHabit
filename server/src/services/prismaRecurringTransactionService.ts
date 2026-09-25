import { Category, Prisma, RecurringTransaction } from '@prisma/client';
import {
  CreateRecurringTransactionInput,
  ListRecurringTransactionsQuery,
  UpdateRecurringTransactionInput,
} from '../schemas/recurringTransactionSchemas.js';
import { prisma } from '../config/prisma.js';
import { startOfUtcDay } from '../utils/date.js';
import { collectDueOccurrences, nextOccurrenceAfter } from '../utils/recurrence.js';

export type RecurringTransactionWithCategory = RecurringTransaction & {
  category: Category;
};

export async function createRecurringTransaction(
  userId: string,
  input: CreateRecurringTransactionInput
): Promise<RecurringTransactionWithCategory> {
  return prisma.recurringTransaction.create({
    data: {
      userId,
      categoryId: input.categoryId,
      type: input.type,
      amount: input.amount,
      name: input.name,
      frequency: input.frequency,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      nextOccurrenceDate: input.startDate,
      isActive: input.isActive ?? true,
    },
    include: { category: true },
  });
}

export async function listUserRecurringTransactions(
  userId: string,
  query?: ListRecurringTransactionsQuery
): Promise<RecurringTransactionWithCategory[]> {
  const where: Prisma.RecurringTransactionWhereInput = { userId };

  if (query?.isActive !== undefined) {
    where.isActive = query.isActive === 'true';
  }

  return prisma.recurringTransaction.findMany({
    where,
    include: { category: true },
    orderBy: [{ createdAt: 'desc' }],
  });
}

export async function findUserRecurringTransaction(
  id: string,
  userId: string
): Promise<RecurringTransactionWithCategory | null> {
  return prisma.recurringTransaction.findFirst({
    where: { id, userId },
    include: { category: true },
  });
}

export async function updateRecurringTransaction(
  id: string,
  input: UpdateRecurringTransactionInput
): Promise<RecurringTransactionWithCategory> {
  const data: Prisma.RecurringTransactionUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.categoryId !== undefined) data.category = { connect: { id: input.categoryId } };
  if (input.type !== undefined) data.type = input.type;
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.frequency !== undefined) data.frequency = input.frequency;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.startDate !== undefined) {
    data.startDate = input.startDate;
    data.nextOccurrenceDate = input.startDate;
  }
  if (input.endDate !== undefined) {
    data.endDate = input.endDate;
  }

  return prisma.recurringTransaction.update({
    where: { id },
    data,
    include: { category: true },
  });
}

export async function deleteRecurringTransaction(id: string): Promise<void> {
  await prisma.recurringTransaction.delete({
    where: { id },
  });
}

function isOccurrenceDuplicateError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

export interface RuleGenerationResult {
  occurrencesCreated: number;
  nextOccurrenceDate: Date;
}

/**
 * Generates every due occurrence for one rule up to `horizon` (inclusive).
 *
 * Idempotency: each occurrence is a (recurringTransactionId, transactionDate)
 * pair guarded by a database unique constraint, so re-running generation — even
 * concurrently — can never create a duplicate. The cursor advance is a
 * compare-and-swap so a concurrent update (another run or a user edit) cannot
 * be overwritten.
 */
export async function generateOccurrencesForRule(
  rule: RecurringTransaction,
  horizon: Date
): Promise<RuleGenerationResult> {
  const anchorDay = rule.startDate.getUTCDate();
  const anchorMonthIndex = rule.startDate.getUTCMonth();

  const dueDates = collectDueOccurrences(
    rule.nextOccurrenceDate,
    horizon,
    rule.endDate,
    rule.frequency,
    anchorDay,
    anchorMonthIndex
  );

  let occurrencesCreated = 0;

  for (const occurrenceDate of dueDates) {
    try {
      await prisma.transaction.create({
        data: {
          userId: rule.userId,
          categoryId: rule.categoryId,
          type: rule.type,
          amount: rule.amount,
          description: rule.name,
          transactionDate: occurrenceDate,
          recurringTransactionId: rule.id,
        },
      });
      occurrencesCreated += 1;
    } catch (error) {
      if (isOccurrenceDuplicateError(error)) {
        continue;
      }
      throw error;
    }
  }

  if (dueDates.length === 0) {
    return {
      occurrencesCreated: 0,
      nextOccurrenceDate: rule.nextOccurrenceDate,
    };
  }

  const lastOccurrence = dueDates[dueDates.length - 1];
  const newCursor = nextOccurrenceAfter(
    lastOccurrence,
    anchorDay,
    anchorMonthIndex,
    rule.frequency
  );

  const updated = await prisma.recurringTransaction.updateMany({
    where: { id: rule.id, nextOccurrenceDate: rule.nextOccurrenceDate },
    data: { nextOccurrenceDate: newCursor },
  });

  if (updated.count === 0) {
    const fresh = await prisma.recurringTransaction.findUnique({
      where: { id: rule.id },
    });
    return {
      occurrencesCreated,
      nextOccurrenceDate: fresh?.nextOccurrenceDate ?? newCursor,
    };
  }

  return { occurrencesCreated, nextOccurrenceDate: newCursor };
}

export async function generateDueOccurrencesForRule(
  id: string,
  userId: string,
  horizon: Date
): Promise<RuleGenerationResult | null> {
  const rule = await prisma.recurringTransaction.findFirst({
    where: { id, userId },
  });

  if (!rule) {
    return null;
  }

  if (!rule.isActive) {
    return {
      occurrencesCreated: 0,
      nextOccurrenceDate: rule.nextOccurrenceDate,
    };
  }

  return generateOccurrencesForRule(rule, horizon);
}

export async function generateDueOccurrencesForUser(
  userId: string,
  horizon: Date
): Promise<{ rulesProcessed: number; occurrencesCreated: number }> {
  const rules = await prisma.recurringTransaction.findMany({
    where: { userId, isActive: true, nextOccurrenceDate: { lte: horizon } },
  });

  let occurrencesCreated = 0;

  for (const rule of rules) {
    const result = await generateOccurrencesForRule(rule, horizon);
    occurrencesCreated += result.occurrencesCreated;
  }

  return { rulesProcessed: rules.length, occurrencesCreated };
}

export function currentProcessingDate(): Date {
  return startOfUtcDay(new Date());
}
