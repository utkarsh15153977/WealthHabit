import { Router } from 'express';
import {
  getAnalyticsSummaryHandler,
  getAssetAnalyticsHandler,
  getCashFlowAnalyticsHandler,
  getLiabilityAnalyticsHandler,
  getNetWorthAnalyticsHandler,
} from '../controllers/wealthAnalyticsController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  analyticsEmptyQuerySchema,
  analyticsRangeSchema,
} from '../schemas/wealthAnalyticsSchemas.js';

/**
 * Wealth Analytics exposes GET routes only: there is no POST, PATCH or DELETE
 * here, so analytics can never write back to a financial record.
 */
export const wealthAnalyticsRouter = Router();

wealthAnalyticsRouter.get(
  '/summary',
  authenticate,
  validate(analyticsEmptyQuerySchema),
  asyncHandler(getAnalyticsSummaryHandler)
);

wealthAnalyticsRouter.get(
  '/net-worth',
  authenticate,
  validate(analyticsRangeSchema),
  asyncHandler(getNetWorthAnalyticsHandler)
);

wealthAnalyticsRouter.get(
  '/assets',
  authenticate,
  validate(analyticsEmptyQuerySchema),
  asyncHandler(getAssetAnalyticsHandler)
);

wealthAnalyticsRouter.get(
  '/liabilities',
  authenticate,
  validate(analyticsEmptyQuerySchema),
  asyncHandler(getLiabilityAnalyticsHandler)
);

wealthAnalyticsRouter.get(
  '/cash-flow',
  authenticate,
  validate(analyticsRangeSchema),
  asyncHandler(getCashFlowAnalyticsHandler)
);
