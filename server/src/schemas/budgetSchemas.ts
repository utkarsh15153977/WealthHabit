import { z } from 'zod';
import { amountSchema } from './transactionSchemas.js';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const budgetMonthSchema = z
  .string()
  .trim()
  .regex(MONTH_PATTERN, 'Invalid month format. Use YYYY-MM')
  .transform((value) => {
    const [year, monthNum] = value.split('-').map(Number);
    return new Date(Date.UTC(year, monthNum - 1, 1));
  });

export const createBudgetSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1, 'Budget name is required').max(100),
      amount: amountSchema,
      month: budgetMonthSchema,
      categoryId: z.string().min(1, 'Category is required').nullish(),
    })
    .strict(),
});

export const budgetIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Budget id is required'),
  }),
});

export const updateBudgetSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Budget id is required'),
  }),
  body: z
    .object({
      name: z.string().trim().min(1, 'Budget name is required').max(100).optional(),
      amount: amountSchema.optional(),
      month: budgetMonthSchema.optional(),
      categoryId: z.string().min(1, 'Category is required').nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export const listBudgetsSchema = z.object({
  query: z
    .object({
      month: budgetMonthSchema.optional(),
    })
    .strict(),
});

export type CreateBudgetInput = z.infer<typeof createBudgetSchema.shape.body>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema.shape.body>;
export type ListBudgetsQuery = z.infer<typeof listBudgetsSchema.shape.query>;
