import { Router } from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/rbacMiddleware.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  adminChallengeIdParamSchema,
  listAdminChallengesSchema,
} from '../schemas/adminChallengeSchemas.js';
import {
  getAdminChallengeHandler,
  listAdminChallengesHandler,
} from '../controllers/adminChallengeController.js';

const router = Router();

/**
 * Admin challenge READ surface (Phase 5F-5). Mutations deliberately stay
 * on the existing `/api/challenges` routes (already
 * authenticate → requireAdmin): this router is GET-only, so
 * POST/PUT/PATCH/DELETE fall through to the 404 handler.
 */
router.get(
  '/challenges',
  authenticate,
  requireAdmin,
  validate(listAdminChallengesSchema),
  asyncHandler(listAdminChallengesHandler)
);

router.get(
  '/challenges/:id',
  authenticate,
  requireAdmin,
  validate(adminChallengeIdParamSchema),
  asyncHandler(getAdminChallengeHandler)
);

export default router;
