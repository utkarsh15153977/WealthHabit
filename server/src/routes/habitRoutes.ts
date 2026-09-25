import { Router } from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createHabitSchema,
  habitIdParamSchema,
  habitProgressHistorySchema,
  listHabitCompletionsSchema,
  listHabitsSchema,
  updateHabitSchema,
} from '../schemas/habitSchemas.js';
import {
  completeHabitHandler,
  createHabitHandler,
  deleteHabitHandler,
  getHabitHandler,
  getHabitProgressHandler,
  getHabitProgressHistoryHandler,
  listCompletionsHandler,
  listHabitsHandler,
  uncompleteHabitHandler,
  updateHabitHandler,
} from '../controllers/habitController.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  validate(listHabitsSchema),
  asyncHandler(listHabitsHandler)
);
router.post(
  '/',
  validate(createHabitSchema),
  asyncHandler(createHabitHandler)
);
router.get(
  '/:id',
  validate(habitIdParamSchema),
  asyncHandler(getHabitHandler)
);
router.patch(
  '/:id',
  validate(updateHabitSchema),
  asyncHandler(updateHabitHandler)
);
router.delete(
  '/:id',
  validate(habitIdParamSchema),
  asyncHandler(deleteHabitHandler)
);
router.post(
  '/:id/complete',
  validate(habitIdParamSchema),
  asyncHandler(completeHabitHandler)
);
router.delete(
  '/:id/complete',
  validate(habitIdParamSchema),
  asyncHandler(uncompleteHabitHandler)
);
router.get(
  '/:id/completions',
  validate(listHabitCompletionsSchema),
  asyncHandler(listCompletionsHandler)
);
router.get(
  '/:id/progress',
  validate(habitIdParamSchema),
  asyncHandler(getHabitProgressHandler)
);
router.get(
  '/:id/progress/history',
  validate(habitProgressHistorySchema),
  asyncHandler(getHabitProgressHistoryHandler)
);

export default router;
