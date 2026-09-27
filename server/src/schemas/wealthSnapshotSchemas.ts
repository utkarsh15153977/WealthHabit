import { z } from 'zod';

const snapshotIdParams = z.object({
  id: z.string().min(1, 'Snapshot id is required'),
});

/**
 * A snapshot is derived, never submitted: the server picks today's UTC day
 * and reads every figure from the caller's own assets and liabilities.
 * The body is therefore an empty, closed object — any key (`userId`,
 * `snapshotDate`, `netWorth`, …) is a 400 rather than a mass-assignment risk.
 */
export const createWealthSnapshotSchema = z.object({
  body: z.object({}).strict().optional(),
});

export const listWealthSnapshotsSchema = z.object({
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

export const wealthSnapshotIdParamSchema = z.object({
  params: snapshotIdParams,
});

export type ListWealthSnapshotsQuery = z.infer<
  typeof listWealthSnapshotsSchema.shape.query
>;
