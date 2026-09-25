import { z } from 'zod';
import { GoalPriority, GoalStatus } from '@prisma/client';
import { amountSchema, dayDateSchema } from './transactionSchemas.js';

const goalPriorityValues = Object.values(GoalPriority) as [
  GoalPriority,
  ...GoalPriority[],
];

const goalStatusValues = Object.values(GoalStatus) as [
  GoalStatus,
  ...GoalStatus[],
];

const mutableGoalStatusValues = ['ACTIVE', 'PAUSED', 'CANCELLED'] as const;

const goalIdParams = z.object({
  id: z.string().min(1, 'Goal id is required'),
});

const contributionParams = z.object({
  id: z.string().min(1, 'Goal id is required'),
  contributionId: z.string().min(1, 'Contribution id is required'),
});

const noteSchema = z
  .string()
  .trim()
  .max(500, 'Note must be at most 500 characters');

export const createGoalSchema = z.object({
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
        .max(1000, 'Description must be at most 1000 characters')
        .optional(),
      targetAmount: amountSchema,
      targetDate: dayDateSchema,
      category: z
        .string()
        .trim()
        .min(1, 'Category is required')
        .max(50, 'Category must be at most 50 characters')
        .optional(),
      priority: z.enum(goalPriorityValues, {
        errorMap: () => ({ message: 'Priority must be LOW, MEDIUM or HIGH' }),
      }).optional(),
      monthlyContribution: amountSchema.nullable().optional(),
    })
    .strict(),
});

export const updateGoalSchema = z.object({
  params: goalIdParams,
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
        .max(1000, 'Description must be at most 1000 characters')
        .nullable()
        .optional(),
      targetAmount: amountSchema.optional(),
      targetDate: dayDateSchema.optional(),
      category: z
        .string()
        .trim()
        .min(1, 'Category is required')
        .max(50, 'Category must be at most 50 characters')
        .optional(),
      priority: z.enum(goalPriorityValues, {
        errorMap: () => ({ message: 'Priority must be LOW, MEDIUM or HIGH' }),
      }).optional(),
      status: z
        .enum(mutableGoalStatusValues, {
          errorMap: () => ({
            message: 'Status must be ACTIVE, PAUSED or CANCELLED',
          }),
        })
        .optional(),
      monthlyContribution: amountSchema.nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export const listGoalsSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1, 'Page must be at least 1').optional(),
      pageSize: z.coerce
        .number()
        .int()
        .min(1, 'Page size must be at least 1')
        .max(50, 'Page size must be at most 50')
        .optional(),
      status: z.enum(goalStatusValues).optional(),
    })
    .strict(),
});

export const goalIdParamSchema = z.object({
  params: goalIdParams,
});

export const listContributionsSchema = z.object({
  params: goalIdParams,
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

export const createContributionSchema = z.object({
  params: goalIdParams,
  body: z
    .object({
      amount: amountSchema,
      contributionDate: dayDateSchema.optional(),
      note: noteSchema.optional(),
    })
    .strict(),
});

export const updateContributionSchema = z.object({
  params: contributionParams,
  body: z
    .object({
      amount: amountSchema.optional(),
      contributionDate: dayDateSchema.optional(),
      note: noteSchema.nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export const contributionIdParamSchema = z.object({
  params: contributionParams,
});

export type CreateGoalInput = z.infer<typeof createGoalSchema.shape.body>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema.shape.body>;
export type ListGoalsQuery = z.infer<typeof listGoalsSchema.shape.query>;
export type ListContributionsQuery = z.infer<
  typeof listContributionsSchema.shape.query
>;
export type CreateContributionInput = z.infer<
  typeof createContributionSchema.shape.body
>;
export type UpdateContributionInput = z.infer<
  typeof updateContributionSchema.shape.body
>;
