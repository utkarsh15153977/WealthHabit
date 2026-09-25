import { z } from 'zod';
import { TransactionType } from '@prisma/client';
import { startOfUtcDay } from '../utils/date.js';

export const transactionTypeValues = Object.values(TransactionType) as [
  TransactionType,
  ...TransactionType[],
];

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const MONEY_MAX = 9999999999999.99;

export const amountSchema = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const raw = typeof value === 'number' ? value.toFixed(2) : value.trim();

    if (!MONEY_PATTERN.test(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount must be a positive number with up to 2 decimal places',
      });
      return z.NEVER;
    }

    const numeric = Number(raw);
    if (numeric <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount must be greater than zero',
      });
      return z.NEVER;
    }

    if (numeric > MONEY_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount exceeds the maximum allowed value',
      });
      return z.NEVER;
    }

    return raw;
  });

const dateSchema = z
  .union([z.string(), z.date()])
  .transform((value, ctx) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid transaction date',
      });
      return z.NEVER;
    }
    return date;
  });

export const dayDateSchema = z
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

export const createTransactionSchema = z.object({
  body: z
    .object({
      categoryId: z.string().min(1, 'Category is required'),
      type: z.enum(transactionTypeValues, {
        errorMap: () => ({ message: 'Type must be INCOME or EXPENSE' }),
      }),
      amount: amountSchema,
      description: z.string().trim().max(500).nullable().optional(),
      transactionDate: dateSchema,
      paymentMethod: z.string().trim().max(100).nullable().optional(),
      notes: z.string().trim().max(1000).nullable().optional(),
    })
    .strict(),
});

export const transactionIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Transaction id is required'),
  }),
});

export const updateTransactionSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Transaction id is required'),
  }),
  body: z
    .object({
      categoryId: z.string().min(1, 'Category is required').optional(),
      type: z
        .enum(transactionTypeValues, {
          errorMap: () => ({ message: 'Type must be INCOME or EXPENSE' }),
        })
        .optional(),
      amount: amountSchema.optional(),
      description: z.string().trim().max(500).nullable().optional(),
      transactionDate: dateSchema.optional(),
      paymentMethod: z.string().trim().max(100).nullable().optional(),
      notes: z.string().trim().max(1000).nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export const listTransactionsSchema = z.object({
  query: z
    .object({
      type: z.enum(transactionTypeValues).optional(),
      categoryId: z.string().min(1).optional(),
      dateFrom: z.coerce.date().optional(),
      dateTo: z.coerce.date().optional(),
      search: z.string().trim().max(200).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .strict(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema.shape.body>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema.shape.body>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsSchema.shape.query>;
