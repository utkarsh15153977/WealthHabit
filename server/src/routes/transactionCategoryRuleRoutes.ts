import { Router } from 'express';
import {
  createTransactionCategoryRuleHandler,
  deleteTransactionCategoryRuleHandler,
  listTransactionCategoryRulesHandler,
  updateTransactionCategoryRuleHandler,
} from '../controllers/transactionCategoryRuleController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createTransactionCategoryRuleSchema,
  listTransactionCategoryRuleSchema,
  transactionCategoryRuleIdParamSchema,
  updateTransactionCategoryRuleSchema,
} from '../schemas/transactionCategoryRuleSchemas.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  validate(listTransactionCategoryRuleSchema),
  asyncHandler(listTransactionCategoryRulesHandler)
);
router.post(
  '/',
  validate(createTransactionCategoryRuleSchema),
  asyncHandler(createTransactionCategoryRuleHandler)
);
router.patch(
  '/:id',
  validate(updateTransactionCategoryRuleSchema),
  asyncHandler(updateTransactionCategoryRuleHandler)
);
router.delete(
  '/:id',
  validate(transactionCategoryRuleIdParamSchema),
  asyncHandler(deleteTransactionCategoryRuleHandler)
);

export default router;
