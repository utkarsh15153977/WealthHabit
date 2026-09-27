import { z } from 'zod';
import {
  ASSET_TYPES,
  LIABILITY_TYPES,
  AssetType,
  LiabilityType,
} from '../types/assetLiability.js';

const assetTypeValues = ASSET_TYPES as unknown as [AssetType, ...AssetType[]];
const liabilityTypeValues = LIABILITY_TYPES as unknown as [
  LiabilityType,
  ...LiabilityType[],
];

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const MONEY_MAX = 9999999999999.99;

/**
 * Same shape as the shared amountSchema but tolerant of zero: an asset can
 * legitimately be worth 0 and a liability can legitimately be fully repaid.
 * Returns the original decimal string so Prisma never sees a float.
 */
export const nonNegativeAmountSchema = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const raw = typeof value === 'number' ? value.toFixed(2) : value.trim();

    if (!MONEY_PATTERN.test(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Amount must be a non-negative number with up to 2 decimal places',
      });
      return z.NEVER;
    }

    const numeric = Number(raw);
    if (numeric < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount cannot be negative',
      });
      return z.NEVER;
    }

    if (numeric > MONEY_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount exceeds the maximum allowed value',
      });
      return z.NEVER;
    }

    return raw;
  });

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name must be at most 100 characters');

const notesSchema = z
  .string()
  .trim()
  .max(1000, 'Notes must be at most 1000 characters');

const assetTypeSchema = z.enum(assetTypeValues, {
  errorMap: () => ({
    message:
      'Type must be CASH, BANK_ACCOUNT, FIXED_DEPOSIT, PROPERTY, VEHICLE, GOLD, INVESTMENT or OTHER',
  }),
});

const liabilityTypeSchema = z.enum(liabilityTypeValues, {
  errorMap: () => ({
    message:
      'Type must be CREDIT_CARD, PERSONAL_LOAN, HOME_LOAN, VEHICLE_LOAN, EDUCATION_LOAN or OTHER',
  }),
});

const idParams = z.object({
  id: z.string().min(1, 'Asset id is required'),
});

const liabilityIdParams = z.object({
  id: z.string().min(1, 'Liability id is required'),
});

export const createAssetSchema = z.object({
  body: z
    .object({
      name: nameSchema,
      type: assetTypeSchema.optional(),
      currentValue: nonNegativeAmountSchema,
      notes: notesSchema.optional(),
    })
    .strict(),
});

export const updateAssetSchema = z.object({
  params: idParams,
  body: z
    .object({
      name: nameSchema.optional(),
      type: assetTypeSchema.optional(),
      currentValue: nonNegativeAmountSchema.optional(),
      notes: notesSchema.nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export const listAssetsSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1, 'Page must be at least 1').optional(),
      pageSize: z.coerce
        .number()
        .int()
        .min(1, 'Page size must be at least 1')
        .max(50, 'Page size must be at most 50')
        .optional(),
      type: assetTypeSchema.optional(),
    })
    .strict(),
});

export const assetIdParamSchema = z.object({
  params: idParams,
});

export const createLiabilitySchema = z.object({
  body: z
    .object({
      name: nameSchema,
      type: liabilityTypeSchema.optional(),
      outstandingAmount: nonNegativeAmountSchema,
      notes: notesSchema.optional(),
    })
    .strict(),
});

export const updateLiabilitySchema = z.object({
  params: liabilityIdParams,
  body: z
    .object({
      name: nameSchema.optional(),
      type: liabilityTypeSchema.optional(),
      outstandingAmount: nonNegativeAmountSchema.optional(),
      notes: notesSchema.nullable().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field is required',
    }),
});

export const listLiabilitiesSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1, 'Page must be at least 1').optional(),
      pageSize: z.coerce
        .number()
        .int()
        .min(1, 'Page size must be at least 1')
        .max(50, 'Page size must be at most 50')
        .optional(),
      type: liabilityTypeSchema.optional(),
    })
    .strict(),
});

export const liabilityIdParamSchema = z.object({
  params: liabilityIdParams,
});

export type CreateAssetInput = z.infer<typeof createAssetSchema.shape.body>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema.shape.body>;
export type ListAssetsQuery = z.infer<typeof listAssetsSchema.shape.query>;
export type CreateLiabilityInput = z.infer<
  typeof createLiabilitySchema.shape.body
>;
export type UpdateLiabilityInput = z.infer<
  typeof updateLiabilitySchema.shape.body
>;
export type ListLiabilitiesQuery = z.infer<
  typeof listLiabilitiesSchema.shape.query
>;
