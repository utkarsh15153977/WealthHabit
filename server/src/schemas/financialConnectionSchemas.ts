import { z } from 'zod';
import { FinancialConnectionProvider } from '@prisma/client';

const providerValues = Object.values(FinancialConnectionProvider) as [
  FinancialConnectionProvider,
  ...FinancialConnectionProvider[]
];

export const createFinancialConnectionSchema = z.object({
  body: z
    .object({
      provider: z.enum(providerValues, {
        errorMap: () => ({ message: 'Provider must be a valid value' }),
      }),
    })
    .strict(),
});

export const connectionIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Connection id is required'),
  }),
});

export const accountIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Account id is required'),
  }),
});

export const listFinancialAccountsSchema = z.object({
  query: z
    .object({
      connectionId: z.string().min(1).optional(),
    })
    .strict(),
});

export const syncFinancialAccountSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Account id is required'),
  }),
  query: z
    .object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    })
    .strict()
    .refine(
      (query) => !query.from || !query.to || query.from.getTime() <= query.to.getTime(),
      { message: '`from` must not be after `to`' }
    ),
});

export type CreateFinancialConnectionInput = z.infer<typeof createFinancialConnectionSchema.shape.body>;
export type ConnectionIdParam = z.infer<typeof connectionIdParamSchema.shape.params>;
export type AccountIdParam = z.infer<typeof accountIdParamSchema.shape.params>;
export type ListFinancialAccountsQuery = z.infer<typeof listFinancialAccountsSchema.shape.query>;
export type SyncFinancialAccountQuery = z.infer<typeof syncFinancialAccountSchema.shape.query>;
