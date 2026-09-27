import {
  ANALYTICS_DEFAULT_RANGE_DAYS,
  ANALYTICS_MAX_RANGE_DAYS,
  analyticsRangeSchema,
  type AnalyticsRange,
} from './wealthAnalyticsSchemas.js';

/**
 * Reports reuse the Wealth Analytics range contract verbatim so the two
 * read-only layers can never disagree about what a date range means:
 *
 * - `dateFrom` / `dateTo` are UTC calendar days (midnights in UTC)
 * - transactions are included when `date >= dateFrom AND date < dateTo + 1 day`
 * - snapshots are included when `dateFrom <= snapshotDate <= dateTo`
 * - no range supplied defaults to the last 365 days ending today (UTC)
 * - a span wider than 1825 days, a reversed range or a malformed date is 400
 *
 * The schema is strict, so `?userId=`, `?netWorth=` or any other smuggled
 * parameter is a 400 rather than a silently ignored mass assignment.
 */
export const REPORT_DEFAULT_RANGE_DAYS = ANALYTICS_DEFAULT_RANGE_DAYS;
export const REPORT_MAX_RANGE_DAYS = ANALYTICS_MAX_RANGE_DAYS;

export const financialReportQuerySchema = analyticsRangeSchema;

export type { AnalyticsRange };
