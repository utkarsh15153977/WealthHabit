import { Router } from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/rbacMiddleware.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  challengeIdParamSchema,
  createChallengeSchema,
  listChallengesSchema,
  mapChallengeHabitSchema,
  updateChallengeSchema,
} from '../schemas/challengeSchemas.js';
import {
  createChallengeHandler,
  deleteChallengeHandler,
  getChallengeHandler,
  getChallengeProgressHandler,
  joinChallengeHandler,
  leaveChallengeHandler,
  listChallengesHandler,
  mapRequirementHabitHandler,
  updateChallengeHandler,
} from '../controllers/challengeController.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  validate(listChallengesSchema),
  asyncHandler(listChallengesHandler)
);
router.post(
  '/',
  requireAdmin,
  validate(createChallengeSchema),
  asyncHandler(createChallengeHandler)
);
router.get(
  '/:id',
  validate(challengeIdParamSchema),
  asyncHandler(getChallengeHandler)
);
router.patch(
  '/:id',
  requireAdmin,
  validate(updateChallengeSchema),
  asyncHandler(updateChallengeHandler)
);
router.delete(
  '/:id',
  requireAdmin,
  validate(challengeIdParamSchema),
  asyncHandler(deleteChallengeHandler)
);
router.post(
  '/:id/join',
  validate(challengeIdParamSchema),
  asyncHandler(joinChallengeHandler)
);
router.delete(
  '/:id/leave',
  validate(challengeIdParamSchema),
  asyncHandler(leaveChallengeHandler)
);
router.get(
  '/:id/progress',
  validate(challengeIdParamSchema),
  asyncHandler(getChallengeProgressHandler)
);
router.post(
  '/:id/requirements/:requirementId/habit',
  validate(mapChallengeHabitSchema),
  asyncHandler(mapRequirementHabitHandler)
);

export default router;
