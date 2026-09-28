import { z } from 'zod';
import { ChallengeType } from '@prisma/client';
import { startOfUtcDay } from '../utils/date.js';

const challengeTypeValues = Object.values(ChallengeType) as [
  ChallengeType,
  ...ChallengeType[],
];

const challengeIdParams = z.object({
  id: z.string().min(1, 'Challenge id is required'),
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Same bounded-range policy as audit logs and analytics: a provided
 * startDate range can never span more than 5 years, so no client can
 * issue an unbounded scan.
 */
export const ADMIN_CHALLENGE_MAX_RANGE_DAYS = 1825;

const rawQuery = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1, 'Page must be at least 1')
    .optional(),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'Page size must be at least 1')
    .max(50, 'Page size must be at most 50')
    .optional(),
  search: z
    .string()
    .trim()
    .max(100, 'Search must be at most 100 characters')
    .optional(),
  type: z
    .enum(challengeTypeValues, {
      errorMap: () => ({ message: 'Type must be HABIT_COMPLETION' }),
    })
    .optional(),
  status: z
    .enum(['UPCOMING', 'ACTIVE', 'ENDED'], {
      errorMap: () => ({
        message: 'Status must be UPCOMING, ACTIVE or ENDED',
      }),
    })
    .optional(),
  active: z.enum(['true', 'false']).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

/**
 * Strict query contract for `GET /api/admin/challenges`: unknown
 * parameters are a 400, dates must parse, and a reversed or unbounded
 * startDate range is rejected. `dateFrom`/`dateTo` are UTC calendar days
 * and filter on the challenge startDate (dateTo inclusive), using the
 * same range semantics as audit logs and analytics. The derived
 * `status` filter uses the same UTC calendar semantics as the public
 * challenge list.
 */
export const listAdminChallengesSchema = z.object({
  query: rawQuery
    .strict()
    .superRefine((query, ctx) => {
      if (!query.dateFrom || !query.dateTo) {
        return;
      }

      const from = startOfUtcDay(query.dateFrom).getTime();
      const to = startOfUtcDay(query.dateTo).getTime();

      if (from > to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'dateFrom must be on or before dateTo',
        });
        return;
      }

      if ((to - from) / MS_PER_DAY > ADMIN_CHALLENGE_MAX_RANGE_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Date range must not exceed ${ADMIN_CHALLENGE_MAX_RANGE_DAYS} days`,
        });
      }
    }),
});

export const adminChallengeIdParamSchema = z.object({
  params: challengeIdParams,
});

export type ListAdminChallengesQuery = z.infer<
  typeof listAdminChallengesSchema.shape.query
>;
