import { Router } from 'express';
import {
  createRecurringTransactionHandler,
  deleteRecurringTransactionHandler,
  generateAllOccurrencesHandler,
  generateOccurrencesHandler,
  getRecurringTransactionHandler,
  listRecurringTransactionsHandler,
  updateRecurringTransactionHandler,
} from '../controllers/recurringTransactionController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  createRecurringTransactionSchema,
  listRecurringTransactionsSchema,
  recurringTransactionIdParamSchema,
  updateRecurringTransactionSchema,
} from '../schemas/recurringTransactionSchemas.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get(
  '/',
  authenticate,
  validate(listRecurringTransactionsSchema),
  asyncHandler(listRecurringTransactionsHandler)
);
router.post(
  '/',
  authenticate,
  validate(createRecurringTransactionSchema),
  asyncHandler(createRecurringTransactionHandler)
);
router.post(
  '/generate',
  authenticate,
  asyncHandler(generateAllOccurrencesHandler)
);
router.get(
  '/:id',
  authenticate,
  validate(recurringTransactionIdParamSchema),
  asyncHandler(getRecurringTransactionHandler)
);
router.patch(
  '/:id',
  authenticate,
  validate(recurringTransactionIdParamSchema),
  validate(updateRecurringTransactionSchema),
  asyncHandler(updateRecurringTransactionHandler)
);
router.delete(
  '/:id',
  authenticate,
  validate(recurringTransactionIdParamSchema),
  asyncHandler(deleteRecurringTransactionHandler)
);
router.post(
  '/:id/generate',
  authenticate,
  validate(recurringTransactionIdParamSchema),
  asyncHandler(generateOccurrencesHandler)
);

export default router;
