import { Router } from 'express';
import { getDashboardSummaryHandler } from '../controllers/dashboardController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { dashboardSummarySchema } from '../schemas/dashboardSchemas.js';

const router = Router();

router.get(
  '/summary',
  authenticate,
  validate(dashboardSummarySchema),
  asyncHandler(getDashboardSummaryHandler)
);

export default router;
