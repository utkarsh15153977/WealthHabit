import { z } from 'zod';

export const getMeSchema = z.object({});

const profileTargetMax = 9999999999999.99;

export const updateMeSchema = z.object({
  body: z
    .object({
      firstName: z.string().trim().min(1, 'First name is required').max(50).optional(),
      lastName: z.string().trim().min(1, 'Last name is required').max(50).optional(),
      currency: z.string().trim().min(1, 'Currency is required').max(10).optional(),
      monthlyIncomeTarget: z.number().min(0).max(profileTargetMax).nullable().optional(),
      monthlySavingsTarget: z.number().min(0).max(profileTargetMax).nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema.shape.body>;
