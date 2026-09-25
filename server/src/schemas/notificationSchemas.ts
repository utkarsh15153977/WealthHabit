import { z } from 'zod';

export const listNotificationsSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1, 'Page must be at least 1').optional(),
      pageSize: z.coerce
        .number()
        .int()
        .min(1, 'Page size must be at least 1')
        .max(50, 'Page size must be at most 50')
        .optional(),
      unreadOnly: z.enum(['true', 'false']).optional(),
    })
    .strict(),
});

export const notificationIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Notification id is required'),
  }),
});

export type ListNotificationsQuery = z.infer<
  typeof listNotificationsSchema.shape.query
>;
