import { z } from 'zod';

export const dashboardSummarySchema = z.object({
  query: z
    .object({
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Invalid month format. Use YYYY-MM')
        .optional(),
      trendMonths: z.coerce.number().int().min(1).max(24).optional(),
      recentLimit: z.coerce.number().int().min(1).max(20).optional(),
      categoryLimit: z.coerce.number().int().min(1).max(50).optional(),
    })
    .strict(),
});

export type DashboardSummaryQuery = z.infer<typeof dashboardSummarySchema.shape.query>;
