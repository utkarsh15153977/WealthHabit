import { z } from 'zod';
import { AuditActions } from '../services/auditLogService.js';
import { startOfUtcDay } from '../utils/date.js';

type AuditActionValue = (typeof AuditActions)[keyof typeof AuditActions];

/**
 * The authoritative action set lives with the audit writer
 * (`AuditActions` in auditLogService). `AuditLog.action` is a plain
 * String column, so the filter enum is derived from those constants
 * rather than accepting arbitrary strings.
 */
const actionValues = Object.values(AuditActions) as [
  AuditActionValue,
  ...AuditActionValue[],
];

/**
 * Identifier shape for the actor/target filters: Prisma `cuid()` values
 * (a leading "c" followed by lowercase alphanumerics). Anything else is
 * rejected with a 400 instead of silently returning an empty page.
 */
const auditLogUserId = z
  .string()
  .regex(/^c[a-z0-9]{10,40}$/, 'Invalid user id');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Same bounded-range policy as analytics/reports: a provided date range can
 * never span more than 5 years, so no client can issue an unbounded scan.
 * When no range is supplied the query is simply paginated (newest first).
 */
export const AUDIT_LOG_MAX_RANGE_DAYS = 1825;

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
  action: z
    .enum(actionValues, {
      errorMap: () => ({ message: 'Unknown audit action' }),
    })
    .optional(),
  actorUserId: auditLogUserId.optional(),
  entityId: auditLogUserId.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

/**
 * Strict query contract for `GET /api/admin/audit-logs`: unknown parameters
 * are a 400, dates must parse, and a reversed or unbounded range is rejected.
 * `dateFrom`/`dateTo` are UTC calendar days (start of day), and `dateTo` is
 * inclusive through the end of that UTC day — the same range semantics used
 * by wealth analytics and reports.
 */
export const listAuditLogsSchema = z.object({
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

      if ((to - from) / MS_PER_DAY > AUDIT_LOG_MAX_RANGE_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Date range must not exceed ${AUDIT_LOG_MAX_RANGE_DAYS} days`,
        });
      }
    }),
});

export type ListAuditLogsQuery = z.infer<
  typeof listAuditLogsSchema.shape.query
>;
