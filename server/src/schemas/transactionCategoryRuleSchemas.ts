import { z } from 'zod';

const merchantField = z
  .string()
  .trim()
  .min(1, 'Merchant is required')
  .max(200, 'Merchant must be at most 200 characters');

const categoryIdField = z.string().min(1, 'Category is required');

const priorityField = z
  .number()
  .int('Priority must be an integer')
  .min(-1000, 'Priority must be at least -1000')
  .max(1000, 'Priority must be at most 1000');

export const listTransactionCategoryRuleSchema = z.object({
  query: z.object({}).strict(),
});

export const createTransactionCategoryRuleSchema = z.object({
  body: z
    .object({
      merchant: merchantField,
      categoryId: categoryIdField,
      priority: priorityField.optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
});

export const updateTransactionCategoryRuleSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Rule id is required'),
  }),
  body: z
    .object({
      merchant: merchantField.optional(),
      categoryId: categoryIdField.optional(),
      priority: priorityField.optional(),
      isActive: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export const transactionCategoryRuleIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Rule id is required'),
  }),
});

export type CreateTransactionCategoryRuleInput = z.infer<
  typeof createTransactionCategoryRuleSchema.shape.body
>;
export type UpdateTransactionCategoryRuleInput = z.infer<
  typeof updateTransactionCategoryRuleSchema.shape.body
>;
