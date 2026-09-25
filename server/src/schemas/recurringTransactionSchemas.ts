import { z } from 'zod';
import { Frequency } from '@prisma/client';
import { amountSchema, transactionTypeValues } from './transactionSchemas.js';
import { startOfUtcDay } from '../utils/date.js';

const frequencyValues = Object.values(Frequency) as [Frequency, ...Frequency[]];

const dayDateSchema = z
  .union([z.string(), z.date()])
  .transform((value, ctx) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid date',
      });
      return z.NEVER;
    }
    return startOfUtcDay(date);
  });

const recurringFields = {
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters'),
  categoryId: z.string().min(1, 'Category is required'),
  type: z.enum(transactionTypeValues, {
    errorMap: () => ({ message: 'Type must be INCOME or EXPENSE' }),
  }),
  amount: amountSchema,
  frequency: z.enum(frequencyValues, {
    errorMap: () => ({ message: 'Frequency must be DAILY, WEEKLY, MONTHLY or YEARLY' }),
  }),
  startDate: dayDateSchema,
  endDate: dayDateSchema.optional(),
  isActive: z.boolean().optional(),
};

export const createRecurringTransactionSchema = z.object({
  body: z
    .object(recurringFields)
    .strict()
    .refine(
      (body) => body.endDate === undefined || body.endDate.getTime() >= body.startDate.getTime(),
      {
        path: ['endDate'],
        message: 'End date must be on or after start date',
      }
    ),
});

export const recurringTransactionIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Recurring transaction id is required'),
  }),
});

export const updateRecurringTransactionSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Recurring transaction id is required'),
  }),
  body: z
    .object({
      name: recurringFields.name.optional(),
      categoryId: recurringFields.categoryId.optional(),
      type: z
        .enum(transactionTypeValues, {
          errorMap: () => ({ message: 'Type must be INCOME or EXPENSE' }),
        })
        .optional(),
      amount: amountSchema.optional(),
      frequency: z
        .enum(frequencyValues, {
          errorMap: () => ({ message: 'Frequency must be DAILY, WEEKLY, MONTHLY or YEARLY' }),
        })
        .optional(),
      startDate: dayDateSchema.optional(),
      endDate: dayDateSchema.nullable().optional(),
      isActive: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    })
    .refine(
      (body) =>
        body.endDate === undefined ||
        body.endDate === null ||
        body.startDate === undefined ||
        body.endDate.getTime() >= body.startDate.getTime(),
      {
        path: ['endDate'],
        message: 'End date must be on or after start date',
      }
    ),
});

export const listRecurringTransactionsSchema = z.object({
  query: z
    .object({
      isActive: z.enum(['true', 'false']).optional(),
    })
    .strict(),
});

export type CreateRecurringTransactionInput = z.infer<
  typeof createRecurringTransactionSchema.shape.body
>;
export type UpdateRecurringTransactionInput = z.infer<
  typeof updateRecurringTransactionSchema.shape.body
>;
export type ListRecurringTransactionsQuery = z.infer<
  typeof listRecurringTransactionsSchema.shape.query
>;
