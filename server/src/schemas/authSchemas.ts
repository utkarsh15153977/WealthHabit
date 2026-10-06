import { z } from 'zod';

/**
 * The single password policy for the application.
 *
 * Extracted so that registration and password reset cannot drift apart: a
 * reset password must be exactly as acceptable as a registration password, so
 * both schemas reference this one rule rather than restating it.
 */
export const passwordPolicy = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128);

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address').toLowerCase().trim(),
    password: passwordPolicy,
    firstName: z.string().min(1, 'First name is required').max(50).trim(),
    lastName: z.string().min(1, 'Last name is required').max(50).trim(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address').toLowerCase().trim(),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const refreshSchema = z.object({});

export const logoutSchema = z.object({});

export const logoutAllSchema = z.object({});

export const meSchema = z.object({});

/**
 * Strict on purpose: no `userId`, `emailVerifiedAt` or `usedAt` may be supplied,
 * so verification can only ever be driven by a presented token.
 *
 * The token is validated for presence and length only, never for shape. A
 * strict pattern would turn "malformed" into a distinguishable 400
 * (`VALIDATION_ERROR`) separate from the generic invalid-link rejection; here
 * every unusable value hashes to something that simply matches no row and gets
 * the same generic response.
 */
export const verifyEmailSchema = z.object({
  body: z
    .object({
      token: z
        .string()
        .trim()
        .min(1, 'Verification token is required')
        .max(512, 'Verification token is invalid'),
    })
    .strict(),
});

export const resendVerificationSchema = z.object({
  body: z
    .object({
      email: z.string().email('Invalid email address').toLowerCase().trim(),
    })
    .strict(),
});

/**
 * Strict, and the token is checked for presence and length only rather than
 * shape, for the same anti-probing reason as `verifyEmailSchema`: every unusable
 * value must produce the one generic invalid-link rejection rather than a
 * distinguishable validation error.
 */
export const forgotPasswordSchema = z.object({
  body: z
    .object({
      email: z.string().email('Invalid email address').toLowerCase().trim(),
    })
    .strict(),
});

/**
 * The reset token travels in the body, never a query string, so it is not
 * written to the access log by this endpoint or any proxy in front of it. The
 * new password is held to the same shared policy as registration.
 */
export const resetPasswordSchema = z.object({
  body: z
    .object({
      token: z
        .string()
        .trim()
        .min(1, 'Reset token is required')
        .max(512, 'Reset token is invalid'),
      newPassword: passwordPolicy,
    })
    .strict(),
});

export type RegisterInput = z.infer<typeof registerSchema.shape.body>;
export type LoginInput = z.infer<typeof loginSchema.shape.body>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema.shape.body>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema.shape.body>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema.shape.body>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema.shape.body>;