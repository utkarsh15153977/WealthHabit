import { Router } from 'express';
import {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  me,
  verifyEmail,
  resendVerification,
} from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  logoutAllSchema,
  meSchema,
  verifyEmailSchema,
  resendVerificationSchema,
} from '../schemas/authSchemas.js';
import {
  authRateLimit,
  loginRateLimit,
  resendVerificationRateLimit,
} from '../middleware/rateLimit.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.post('/register', authRateLimit, validate(registerSchema), asyncHandler(register));
router.post('/login', loginRateLimit, authRateLimit, validate(loginSchema), asyncHandler(login));
router.post('/refresh', authRateLimit, validate(refreshSchema), asyncHandler(refresh));
router.post('/logout', authRateLimit, validate(logoutSchema), asyncHandler(logout));
router.post('/logout-all', authRateLimit, authenticate, validate(logoutAllSchema), asyncHandler(logoutAll));
router.get('/me', authRateLimit, authenticate, validate(meSchema), asyncHandler(me));

// Email verification. `verify-email` is keyed by an unguessable single-use
// token, so it stays on the general per-IP auth limiter; `resend-verification`
// is keyed by attacker-chosen input (an address), so it additionally gets the
// email+IP limiter, mounted before validation and before any account lookup.
router.post('/verify-email', authRateLimit, validate(verifyEmailSchema), asyncHandler(verifyEmail));
router.post(
  '/resend-verification',
  resendVerificationRateLimit,
  authRateLimit,
  validate(resendVerificationSchema),
  asyncHandler(resendVerification)
);

export default router;