import { Router } from 'express';
import { getMyProfile, updateMyProfile } from '../controllers/userController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { getMeSchema, updateMeSchema } from '../schemas/userSchemas.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/me', authenticate, validate(getMeSchema), asyncHandler(getMyProfile));
router.patch('/me', authenticate, validate(updateMeSchema), asyncHandler(updateMyProfile));

export default router;
