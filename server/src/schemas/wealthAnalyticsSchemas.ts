import { z } from 'zod';
import { addUtcDays, startOfUtcDay } from '../utils/date.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Default analytics window when the client sends no range: the last 12 months,
 * matching the frontend's default "12 months" range option. The maximum span
 * keeps historical analytics queries bounded — an unbounded range is rejected
 * with a 400 instead of scanning years of rows.
 */
export const ANALYTICS_DEFAULT_RANGE_DAYS = 365;
export const ANALYTICS_MAX_RANGE_DAYS = 1825;

/**
 * A resolved UTC calendar-day range. `dateFrom` and `dateTo` are both UTC
 * midnights; consumers use `>= dateFrom` and `< dateTo + 1 day` (transactions)
 * or `<= dateTo` (snapshots, which are stored exactly at UTC midnight).
 */
export interface AnalyticsRange {
  dateFrom: Date;
  dateTo: Date;
}

const rawRangeQuery = z
  .object({
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
  })
  .strict();

/**
 * Range queries are strict (unknown keys are a 400, so no client can smuggle
 * `netWorth=` or `userId=` into analytics), coerced to UTC days, defaulted to
 * the last 12 months and bounded to ANALYTICS_MAX_RANGE_DAYS.
 */
export const analyticsRangeSchema = z.object({
  query: rawRangeQuery
    .transform((raw): AnalyticsRange => {
      const dateTo = startOfUtcDay(raw.dateTo ?? new Date());
      const dateFrom = raw.dateFrom
        ? startOfUtcDay(raw.dateFrom)
        : addUtcDays(dateTo, -ANALYTICS_DEFAULT_RANGE_DAYS);
      return { dateFrom, dateTo };
    })
    .superRefine((range, ctx) => {
      const from = range.dateFrom.getTime();
      const to = range.dateTo.getTime();

      if (from > to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'dateFrom must be on or before dateTo',
        });
        return;
      }

      if ((to - from) / MS_PER_DAY > ANALYTICS_MAX_RANGE_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Date range must not exceed ${ANALYTICS_MAX_RANGE_DAYS} days`,
        });
      }
    }),
});

/**
 * Range-independent analytics (summary, allocation, composition) accept no
 * query at all: any parameter is a 400 rather than an ignored mass assignment.
 */
export const analyticsEmptyQuerySchema = z.object({
  query: z.object({}).strict(),
});

export type AnalyticsRangeQuery = z.infer<
  typeof analyticsRangeSchema.shape.query
>;
