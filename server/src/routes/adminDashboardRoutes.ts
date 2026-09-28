import { Router } from 'express';
import { getAdminDashboardHandler } from '../controllers/adminDashboardController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/rbacMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get(
  '/dashboard',
  authenticate,
  requireAdmin,
  asyncHandler(getAdminDashboardHandler)
);

export default router;