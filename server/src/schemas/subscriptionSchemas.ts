import { z } from 'zod';
import { Frequency, SubscriptionStatus } from '@prisma/client';
import { amountSchema, dayDateSchema } from './transactionSchemas.js';
import { MONTH_KEY_PATTERN } from './billSchemas.js';

const subscriptionStatusValues = Object.values(SubscriptionStatus) as [
  SubscriptionStatus,
  ...SubscriptionStatus[],
];
const frequencyValues = Object.values(Frequency) as [Frequency, ...Frequency[]];

export const createSubscriptionSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required')
        .max(100, 'Name must be at most 100 characters'),
      categoryId: z.string().min(1, 'Category is required').nullish(),
      amount: amountSchema,
      billingCycle: z.enum(frequencyValues, {
        errorMap: () => ({
          message: 'Billing cycle must be DAILY, WEEKLY, MONTHLY or YEARLY',
        }),
      }),
      nextRenewalDate: dayDateSchema,
      status: z
        .enum(subscriptionStatusValues, {
          errorMap: () => ({
            message: 'Status must be ACTIVE, PAUSED, CANCELLED or EXPIRED',
          }),
        })
        .optional(),
    })
    .strict(),
});

export const subscriptionIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Subscription id is required'),
  }),
});

export const updateSubscriptionSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Subscription id is required'),
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
      billingCycle: z
        .enum(frequencyValues, {
          errorMap: () => ({
            message: 'Billing cycle must be DAILY, WEEKLY, MONTHLY or YEARLY',
          }),
        })
        .optional(),
      nextRenewalDate: dayDateSchema.optional(),
      status: z
        .enum(subscriptionStatusValues, {
          errorMap: () => ({
            message: 'Status must be ACTIVE, PAUSED, CANCELLED or EXPIRED',
          }),
        })
        .optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export const listSubscriptionsSchema = z.object({
  query: z
    .object({
      status: z.enum(subscriptionStatusValues).optional(),
      month: z.string().regex(MONTH_KEY_PATTERN, 'Invalid month').optional(),
      active: z.enum(['true', 'false']).optional(),
    })
    .strict(),
});

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema.shape.body>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema.shape.body>;
export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsSchema.shape.query>;
