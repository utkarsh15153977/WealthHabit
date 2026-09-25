import { z } from 'zod';
import { dayDateSchema } from './transactionSchemas.js';
import { HABIT_FREQUENCIES } from '../utils/habitPeriod.js';

const challengeFrequencyValues = HABIT_FREQUENCIES as unknown as [
  (typeof HABIT_FREQUENCIES)[number],
  ...(typeof HABIT_FREQUENCIES)[number][]
];

const challengeIdParams = z.object({
  id: z.string().min(1, 'Challenge id is required'),
});

const requirementInputSchema = z
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
      .optional(),
    frequency: z.enum(challengeFrequencyValues, {
      errorMap: () => ({
        message: 'Frequency must be DAILY, WEEKLY or MONTHLY',
      }),
    }),
    target: z
      .number()
      .int('Target must be an integer')
      .min(1, 'Target must be at least 1')
      .max(100, 'Target must be at most 100')
      .optional(),
    unit: z
      .string()
      .trim()
      .min(1, 'Unit is required')
      .max(30, 'Unit must be at most 30 characters')
      .optional(),
  })
  .strict();

export const createChallengeSchema = z.object({
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
      category: z
        .string()
        .trim()
        .min(1, 'Category is required')
        .max(50, 'Category must be at most 50 characters')
        .optional(),
      difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
      points: z
        .number()
        .int('Points must be an integer')
        .min(0, 'Points must be at least 0')
        .max(1000000, 'Points must be at most 1000000')
        .optional(),
      type: z.enum(['HABIT_COMPLETION']).optional(),
      startDate: dayDateSchema,
      endDate: dayDateSchema,
      requirements: z
        .array(requirementInputSchema)
        .min(1, 'At least one requirement is required')
        .max(10, 'A challenge must have at most 10 requirements'),
    })
    .strict()
    .refine(
      (body) => body.endDate.getTime() >= body.startDate.getTime(),
      {
        message: 'End date must be on or after start date',
        path: ['endDate'],
      }
    ),
});

export const updateChallengeSchema = z.object({
  params: challengeIdParams,
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
        .optional(),
      category: z
        .string()
        .trim()
        .min(1, 'Category is required')
        .max(50, 'Category must be at most 50 characters')
        .optional(),
      difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
      points: z
        .number()
        .int('Points must be an integer')
        .min(0, 'Points must be at least 0')
        .max(1000000, 'Points must be at most 1000000')
        .optional(),
      startDate: dayDateSchema.optional(),
      endDate: dayDateSchema.optional(),
      isActive: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export const challengeIdParamSchema = z.object({
  params: challengeIdParams,
});

export const listChallengesSchema = z.object({
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
      status: z.enum(['UPCOMING', 'ACTIVE', 'ENDED']).optional(),
      joined: z.enum(['true', 'false']).optional(),
      includeProgress: z.enum(['true', 'false']).optional(),
    })
    .strict(),
});

export const mapChallengeHabitSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Challenge id is required'),
    requirementId: z.string().min(1, 'Requirement id is required'),
  }),
  body: z
    .object({
      habitId: z.string().min(1, 'Habit id is required'),
    })
    .strict(),
});

export type CreateChallengeInput = z.infer<typeof createChallengeSchema.shape.body>;
export type UpdateChallengeInput = z.infer<typeof updateChallengeSchema.shape.body>;
export type ListChallengesQuery = z.infer<typeof listChallengesSchema.shape.query>;
