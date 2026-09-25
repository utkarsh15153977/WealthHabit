import { z } from 'zod';
import { amountSchema, dayDateSchema } from './transactionSchemas.js';
import { HABIT_FREQUENCIES } from '../utils/habitPeriod.js';

const habitFrequencyValues = HABIT_FREQUENCIES as unknown as [
  (typeof HABIT_FREQUENCIES)[number],
  ...(typeof HABIT_FREQUENCIES)[number][]
];

export const createHabitSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required')
        .max(100, 'Name must be at most 100 characters'),
      description: z
        .string()
        .trim()
        .max(500, 'Description must be at most 500 characters')
        .nullish(),
      frequency: z.enum(habitFrequencyValues, {
        errorMap: () => ({
          message: 'Frequency must be DAILY, WEEKLY or MONTHLY',
        }),
      }),
      target: amountSchema.nullish(),
      unit: z
        .string()
        .trim()
        .min(1, 'Unit is required')
        .max(30, 'Unit must be at most 30 characters')
        .nullish(),
      startDate: dayDateSchema,
      endDate: dayDateSchema.nullish(),
    })
    .strict()
    .refine(
      (body) =>
        body.endDate === undefined ||
        body.endDate === null ||
        body.endDate.getTime() >= body.startDate.getTime(),
      {
        message: 'End date must be on or after start date',
        path: ['endDate'],
      }
    ),
});

export const updateHabitSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Habit id is required'),
  }),
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required')
        .max(100, 'Name must be at most 100 characters')
        .optional(),
      description: z
        .string()
        .trim()
        .max(500, 'Description must be at most 500 characters')
        .nullable()
        .optional(),
      frequency: z
        .enum(habitFrequencyValues, {
          errorMap: () => ({
            message: 'Frequency must be DAILY, WEEKLY or MONTHLY',
          }),
        })
        .optional(),
      target: amountSchema.nullable().optional(),
      unit: z
        .string()
        .trim()
        .min(1, 'Unit is required')
        .max(30, 'Unit must be at most 30 characters')
        .nullable()
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
        body.startDate === undefined ||
        body.endDate === undefined ||
        body.endDate === null ||
        body.endDate.getTime() >= body.startDate.getTime(),
      {
        message: 'End date must be on or after start date',
        path: ['endDate'],
      }
    ),
});

export const habitIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Habit id is required'),
  }),
});

export const listHabitsSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1, 'Page must be at least 1').optional(),
      pageSize: z.coerce
        .number()
        .int()
        .min(1, 'Page size must be at least 1')
        .max(50, 'Page size must be at most 50')
        .optional(),
      active: z.enum(['true', 'false']).optional(),
      frequency: z.enum(habitFrequencyValues).optional(),
      includeProgress: z.enum(['true', 'false']).optional(),
    })
    .strict(),
});

export const listHabitCompletionsSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Habit id is required'),
  }),
  query: z
    .object({
      page: z.coerce.number().int().min(1, 'Page must be at least 1').optional(),
      pageSize: z.coerce
        .number()
        .int()
        .min(1, 'Page size must be at least 1')
        .max(50, 'Page size must be at most 50')
        .optional(),
    })
    .strict(),
});

export type CreateHabitInput = z.infer<typeof createHabitSchema.shape.body>;
export type UpdateHabitInput = z.infer<typeof updateHabitSchema.shape.body>;
export type ListHabitsQuery = z.infer<typeof listHabitsSchema.shape.query>;
export type ListHabitCompletionsQuery = z.infer<
  typeof listHabitCompletionsSchema.shape.query
>;
