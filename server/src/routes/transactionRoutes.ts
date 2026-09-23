import { Router } from 'express';
import {
  createTransactionHandler,
  deleteTransactionHandler,
  getTransactionHandler,
  listTransactionsHandler,
  updateTransactionHandler,
} from '../controllers/transactionController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  createTransactionSchema,
  listTransactionsSchema,
  transactionIdParamSchema,
  updateTransactionSchema,
} from '../schemas/transactionSchemas.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get(
  '/',
  authenticate,
  validate(listTransactionsSchema),
  asyncHandler(listTransactionsHandler)
);
router.post(
  '/',
  authenticate,
  validate(createTransactionSchema),
  asyncHandler(createTransactionHandler)
);
router.get(
  '/:id',
  authenticate,
  validate(transactionIdParamSchema),
  asyncHandler(getTransactionHandler)
);
router.patch(
  '/:id',
  authenticate,
  validate(transactionIdParamSchema),
  validate(updateTransactionSchema),
  asyncHandler(updateTransactionHandler)
);
router.delete(
  '/:id',
  authenticate,
  validate(transactionIdParamSchema),
  asyncHandler(deleteTransactionHandler)
);

export default router;
