import { z } from 'zod';
import { BillStatus, Frequency } from '@prisma/client';
import { amountSchema, dayDateSchema } from './transactionSchemas.js';

const billStatusValues = Object.values(BillStatus) as [
  BillStatus,
  ...BillStatus[],
];
const frequencyValues = Object.values(Frequency) as [Frequency, ...Frequency[]];

export const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const createBillSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required')
        .max(100, 'Name must be at most 100 characters'),
      categoryId: z.string().min(1, 'Category is required').nullish(),
      amount: amountSchema,
      frequency: z.enum(frequencyValues, {
        errorMap: () => ({ message: 'Frequency must be DAILY, WEEKLY, MONTHLY or YEARLY' }),
      }),
      dueDate: dayDateSchema,
      nextDueDate: dayDateSchema.optional(),
      status: z
        .enum(billStatusValues, {
          errorMap: () => ({ message: 'Status must be PENDING, PAID, OVERDUE or CANCELLED' }),
        })
        .optional(),
      autoPay: z.boolean().optional(),
    })
    .strict(),
});

export const billIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Bill id is required'),
  }),
});

export const updateBillSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Bill id is required'),
  }),
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required')
        .max(100, 'Name must be at most 100 characters')
        .optional(),
      categoryId: z.string().min(1, 'Category is required').nullable().optional(),
      amount: amountSchema.optional(),
      frequency: z
        .enum(frequencyValues, {
          errorMap: () => ({ message: 'Frequency must be DAILY, WEEKLY, MONTHLY or YEARLY' }),
        })
        .optional(),
      dueDate: dayDateSchema.optional(),
      nextDueDate: dayDateSchema.optional(),
      status: z
        .enum(billStatusValues, {
          errorMap: () => ({ message: 'Status must be PENDING, PAID, OVERDUE or CANCELLED' }),
        })
        .optional(),
      autoPay: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export const listBillsSchema = z.object({
  query: z
    .object({
      status: z.enum(billStatusValues).optional(),
      month: z.string().regex(MONTH_KEY_PATTERN, 'Invalid month').optional(),
      active: z.enum(['true', 'false']).optional(),
    })
    .strict(),
});

export type CreateBillInput = z.infer<typeof createBillSchema.shape.body>;
export type UpdateBillInput = z.infer<typeof updateBillSchema.shape.body>;
export type ListBillsQuery = z.infer<typeof listBillsSchema.shape.query>;
