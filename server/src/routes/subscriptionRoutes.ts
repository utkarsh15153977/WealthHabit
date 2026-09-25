import { Router } from 'express';
import {
  createSubscriptionHandler,
  deleteSubscriptionHandler,
  getSubscriptionHandler,
  listSubscriptionsHandler,
  renewSubscriptionHandler,
  updateSubscriptionHandler,
} from '../controllers/subscriptionController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  createSubscriptionSchema,
  listSubscriptionsSchema,
  subscriptionIdParamSchema,
  updateSubscriptionSchema,
} from '../schemas/subscriptionSchemas.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get(
  '/',
  authenticate,
  validate(listSubscriptionsSchema),
  asyncHandler(listSubscriptionsHandler)
);
router.post(
  '/',
  authenticate,
  validate(createSubscriptionSchema),
  asyncHandler(createSubscriptionHandler)
);
router.get(
  '/:id',
  authenticate,
  validate(subscriptionIdParamSchema),
  asyncHandler(getSubscriptionHandler)
);
router.patch(
  '/:id',
  authenticate,
  validate(subscriptionIdParamSchema),
  validate(updateSubscriptionSchema),
  asyncHandler(updateSubscriptionHandler)
);
router.post(
  '/:id/renew',
  authenticate,
  validate(subscriptionIdParamSchema),
  asyncHandler(renewSubscriptionHandler)
);
router.delete(
  '/:id',
  authenticate,
  validate(subscriptionIdParamSchema),
  asyncHandler(deleteSubscriptionHandler)
);

export default router;
