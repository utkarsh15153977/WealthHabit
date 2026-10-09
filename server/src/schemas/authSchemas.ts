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

/**
 * Shared address field for every auth endpoint. The 254-character cap is the
 * RFC 5321 maximum total length of an email address; without it a caller can
 * push an arbitrarily long string into the login path, where it is normalized
 * and used as a rate-limit key before Argon2 is even reached. Order matters:
 * the length check runs last so the existing format/normalization behaviour of
 * every endpoint stays byte-identical.
 */
const emailField = z
  .string()
  .email('Invalid email address')
  .toLowerCase()
  .trim()
  .max(254, 'Email must be at most 254 characters');

export const registerSchema = z.object({
  body: z.object({
    email: emailField,
    password: passwordPolicy,
    firstName: z.string().min(1, 'First name is required').max(50).trim(),
    lastName: z.string().min(1, 'Last name is required').max(50).trim(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: emailField,
    // Presence plus the same 128-character ceiling as `passwordPolicy`: the
    // minimum is deliberately not enforced here (a login attempt must fail on
    // credentials, not reveal the length rule), but nothing longer than the
    // registration ceiling can exist, so accepting more only feeds oversized
    // input to the Argon2 verification.
    password: z
      .string()
      .min(1, 'Password is required')
      .max(128, 'Password must be at most 128 characters'),
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
      email: emailField,
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
      email: emailField,
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

/**
 * Shared by the authenticated enrollment/removal endpoints. The body is strict
 * so no unexpected field can smuggle in, and the re-authentication password is
 * validated only for presence — the policy is the same shared password policy,
 * but a stale minimum would reject nothing a long-time user could not type.
 */
const mfaCurrentPassword = passwordPolicy;

/**
 * A TOTP code is six decimal digits. Anything else fails validation with a
 * distinguishable 400; codes are high-entropy, single-window values, so this
 * does not open an oracle.
 */
const otpCode = z.string().regex(/^\d{6}$/, 'Authenticator code must be 6 digits');

/**
 * Strict on the same anti-probing principle as the reset token schemas: the
 * challenge token is checked for presence and length only, never shape, so a
 * malformed value produces the generic invalid challenge rather than a
 * distinguishable validation error.
 */
const challengeToken = z
  .string()
  .trim()
  .min(1, 'Challenge token is required')
  .max(512, 'Challenge token is invalid');

/**
 * Recovery codes are 12 alphabet symbols shown as XXXX-XXXX-XXXX; the service
 * accepts any casing and any punctuation and normalizes before hashing, so the
 * schema only bounds length.
 */
const recoveryCode = z.string().trim().min(1, 'Recovery code is required').max(64, 'Recovery code is invalid');

export const mfaSetupSchema = z.object({
  body: z.object({ password: mfaCurrentPassword }).strict(),
});

export const mfaEnableSchema = z.object({
  body: z.object({ code: otpCode }).strict(),
});

export const mfaDisableSchema = z.object({
  body: z.object({ password: mfaCurrentPassword, code: otpCode }).strict(),
});

export const mfaRegenerateSchema = z.object({
  body: z.object({ password: mfaCurrentPassword, code: otpCode }).strict(),
});

export const mfaChallengeSchema = z.object({
  body: z.object({ challengeToken, code: otpCode }).strict(),
});

export const mfaRecoverySchema = z.object({
  body: z.object({ challengeToken, recoveryCode }).strict(),
});

/** No body — read-only state for the Profile security card. */
export const mfaStatusSchema = z.object({});

export type MfaSetupInput = z.infer<typeof mfaSetupSchema.shape.body>;
export type MfaEnableInput = z.infer<typeof mfaEnableSchema.shape.body>;
export type MfaDisableInput = z.infer<typeof mfaDisableSchema.shape.body>;
export type MfaRegenerateInput = z.infer<typeof mfaRegenerateSchema.shape.body>;
export type MfaChallengeInput = z.infer<typeof mfaChallengeSchema.shape.body>;
export type MfaRecoveryInput = z.infer<typeof mfaRecoverySchema.shape.body>;