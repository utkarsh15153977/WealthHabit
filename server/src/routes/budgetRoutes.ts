import { Router } from 'express';
import {
  createBudgetHandler,
  deleteBudgetHandler,
  getBudgetHandler,
  getBudgetProgressHandler,
  listBudgetsHandler,
  updateBudgetHandler,
} from '../controllers/budgetController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  budgetIdParamSchema,
  createBudgetSchema,
  listBudgetsSchema,
  updateBudgetSchema,
} from '../schemas/budgetSchemas.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/', authenticate, validate(listBudgetsSchema), asyncHandler(listBudgetsHandler));
router.post('/', authenticate, validate(createBudgetSchema), asyncHandler(createBudgetHandler));
router.get(
  '/:id',
  authenticate,
  validate(budgetIdParamSchema),
  asyncHandler(getBudgetHandler)
);
router.get(
  '/:id/progress',
  authenticate,
  validate(budgetIdParamSchema),
  asyncHandler(getBudgetProgressHandler)
);
router.patch(
  '/:id',
  authenticate,
  validate(budgetIdParamSchema),
  validate(updateBudgetSchema),
  asyncHandler(updateBudgetHandler)
);
router.delete(
  '/:id',
  authenticate,
  validate(budgetIdParamSchema),
  asyncHandler(deleteBudgetHandler)
);

export default router;
