import { Router } from 'express';
import {
  createContributionHandler,
  createGoalHandler,
  deleteContributionHandler,
  deleteGoalHandler,
  getGoalHandler,
  getGoalProgressHandler,
  listContributionsHandler,
  listGoalsHandler,
  updateContributionHandler,
  updateGoalHandler,
} from '../controllers/goalController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  contributionIdParamSchema,
  createContributionSchema,
  createGoalSchema,
  goalIdParamSchema,
  listContributionsSchema,
  listGoalsSchema,
  updateContributionSchema,
  updateGoalSchema,
} from '../schemas/goalSchemas.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/', authenticate, validate(listGoalsSchema), asyncHandler(listGoalsHandler));
router.post('/', authenticate, validate(createGoalSchema), asyncHandler(createGoalHandler));
router.get(
  '/:id',
  authenticate,
  validate(goalIdParamSchema),
  asyncHandler(getGoalHandler)
);
router.patch(
  '/:id',
  authenticate,
  validate(goalIdParamSchema),
  validate(updateGoalSchema),
  asyncHandler(updateGoalHandler)
);
router.delete(
  '/:id',
  authenticate,
  validate(goalIdParamSchema),
  asyncHandler(deleteGoalHandler)
);
router.get(
  '/:id/progress',
  authenticate,
  validate(goalIdParamSchema),
  asyncHandler(getGoalProgressHandler)
);
router.get(
  '/:id/contributions',
  authenticate,
  validate(listContributionsSchema),
  asyncHandler(listContributionsHandler)
);
router.post(
  '/:id/contributions',
  authenticate,
  validate(createContributionSchema),
  asyncHandler(createContributionHandler)
);
router.patch(
  '/:id/contributions/:contributionId',
  authenticate,
  validate(contributionIdParamSchema),
  validate(updateContributionSchema),
  asyncHandler(updateContributionHandler)
);
router.delete(
  '/:id/contributions/:contributionId',
  authenticate,
  validate(contributionIdParamSchema),
  asyncHandler(deleteContributionHandler)
);

export default router;
