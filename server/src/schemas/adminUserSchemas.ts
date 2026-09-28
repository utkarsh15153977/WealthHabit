import { z } from 'zod';
import { AccountStatus, Role } from '@prisma/client';

const roleValues = Object.values(Role) as [Role, ...Role[]];

const accountStatusValues = Object.values(AccountStatus) as [
  AccountStatus,
  ...AccountStatus[],
];

const userIdParams = z.object({
  id: z.string().min(1, 'User id is required'),
});

export const listAdminUsersSchema = z.object({
  query: z
    .object({
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
      role: z
        .enum(roleValues, {
          errorMap: () => ({ message: 'Role must be USER or ADMIN' }),
        })
        .optional(),
      status: z
        .enum(accountStatusValues, {
          errorMap: () => ({
            message: 'Status must be ACTIVE, SUSPENDED or DEACTIVATED',
          }),
        })
        .optional(),
    })
    .strict(),
});

export const adminUserIdParamSchema = z.object({
  params: userIdParams,
});

export const updateAdminUserStatusSchema = z.object({
  params: userIdParams,
  body: z
    .object({
      status: z.enum(accountStatusValues, {
        errorMap: () => ({
          message: 'Status must be ACTIVE, SUSPENDED or DEACTIVATED',
        }),
      }),
    })
    .strict(),
});

export const updateAdminUserRoleSchema = z.object({
  params: userIdParams,
  body: z
    .object({
      role: z.enum(roleValues, {
        errorMap: () => ({ message: 'Role must be USER or ADMIN' }),
      }),
    })
    .strict(),
});

export type ListAdminUsersQuery = z.infer<
  typeof listAdminUsersSchema.shape.query
>;
export type AdminUserIdParams = z.infer<
  typeof adminUserIdParamSchema.shape.params
>;
export type UpdateAdminUserStatusInput = z.infer<
  typeof updateAdminUserStatusSchema.shape.body
>;
export type UpdateAdminUserRoleInput = z.infer<
  typeof updateAdminUserRoleSchema.shape.body
>;
