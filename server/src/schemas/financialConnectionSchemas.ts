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

/**
 * Upper bound on how much history a single sync request may ask a provider
 * for. Mirrors the analytics/report range cap (`ANALYTICS_MAX_RANGE_DAYS`)
 * for the same reason: without it `?from=1970-01-01` is accepted and handed
 * verbatim to the provider, turning one authenticated request into an
 * unbounded fetch. One year is far more than the 90-day default window and is
 * enough for a "backfill my first year" request.
 *
 * Exported so `prismaFinancialSyncService` re-checks the same bound before it
 * calls the provider, keeping a single source of truth for both layers.
 */
export const SYNC_MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

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
    )
    .refine(
      (query) => {
        if (!query.from) return true;
        // Only `from` supplied means the window ends today, so the span that
        // actually reaches the provider is `now - from`.
        const upperBound = query.to ?? new Date();
        return upperBound.getTime() - query.from.getTime() <= SYNC_MAX_RANGE_DAYS * DAY_MS;
      },
      { message: `Sync window must not exceed ${SYNC_MAX_RANGE_DAYS} days` }
    ),
});

export type CreateFinancialConnectionInput = z.infer<typeof createFinancialConnectionSchema.shape.body>;
export type ConnectionIdParam = z.infer<typeof connectionIdParamSchema.shape.params>;
export type AccountIdParam = z.infer<typeof accountIdParamSchema.shape.params>;
export type ListFinancialAccountsQuery = z.infer<typeof listFinancialAccountsSchema.shape.query>;
export type SyncFinancialAccountQuery = z.infer<typeof syncFinancialAccountSchema.shape.query>;
