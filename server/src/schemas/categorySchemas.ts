import { z } from 'zod';
import { CategoryType } from '@prisma/client';

const categoryTypeValues = Object.values(CategoryType) as [CategoryType, ...CategoryType[]];

export const listCategoriesSchema = z.object({
  query: z
    .object({
      type: z.enum(categoryTypeValues).optional(),
    })
    .strict(),
});

export const createCategorySchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1, 'Category name is required').max(100),
      type: z.enum(categoryTypeValues, {
        errorMap: () => ({ message: 'Type must be INCOME or EXPENSE' }),
      }),
      icon: z.string().trim().max(50).nullable().optional(),
      color: z.string().trim().max(50).nullable().optional(),
    })
    .strict(),
});

export const categoryIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Category id is required'),
  }),
});

export const updateCategorySchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Category id is required'),
  }),
  body: z
    .object({
      name: z.string().trim().min(1, 'Category name is required').max(100).optional(),
      icon: z.string().trim().max(50).nullable().optional(),
      color: z.string().trim().max(50).nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export type ListCategoriesQuery = z.infer<typeof listCategoriesSchema.shape.query>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema.shape.body>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema.shape.body>;
