import { Router } from 'express';
import { getSystemHealthHandler } from '../controllers/adminSystemHealthController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/rbacMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

/**
 * System health is read-only and intentionally unaudited (the 5F-4 rule
 * avoids read/audit-of-audit noise). There are no query or body
 * parameters to validate, and no other methods are registered, so the
 * endpoint cannot mutate anything through this router.
 */
router.get(
  '/system-health',
  authenticate,
  requireAdmin,
  asyncHandler(getSystemHealthHandler)
);

export default router;
