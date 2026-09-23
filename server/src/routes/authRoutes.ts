import { Router } from 'express';
import { register, login, refresh, logout, logoutAll, me } from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { registerSchema, loginSchema, refreshSchema, logoutSchema, logoutAllSchema, meSchema } from '../schemas/authSchemas.js';
import { authRateLimit } from '../middleware/rateLimit.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.post('/register', authRateLimit, validate(registerSchema), asyncHandler(register));
router.post('/login', authRateLimit, validate(loginSchema), asyncHandler(login));
router.post('/refresh', authRateLimit, validate(refreshSchema), asyncHandler(refresh));
router.post('/logout', validate(logoutSchema), asyncHandler(logout));
router.post('/logout-all', authenticate, validate(logoutAllSchema), asyncHandler(logoutAll));
router.get('/me', authenticate, validate(meSchema), asyncHandler(me));

export default router;