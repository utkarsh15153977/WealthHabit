import { Router } from 'express';
import {
  createTransactionHandler,
  deleteTransactionHandler,
  getTransactionHandler,
  listTransactionsHandler,
  updateTransactionHandler,
} from '../controllers/transactionController.js';
import {
  convertImportedTransactionToManualHandler,
  listImportedTransactionsHandler,
  recategorizeImportedTransactionHandler,
  unlinkImportedTransactionHandler,
} from '../controllers/importedTransactionController.js';
import {
  bulkRecategorizeImportedTransactionsHandler,
  previewCategorizationHandler,
} from '../controllers/transactionCategorizationController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  bulkRecategorizeSchema,
  categorizationPreviewSchema,
  createTransactionSchema,
  listImportedTransactionsSchema,
  listTransactionsSchema,
  transactionCategorySchema,
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
  '/imported',
  authenticate,
  validate(listImportedTransactionsSchema),
  asyncHandler(listImportedTransactionsHandler)
);
router.post(
  '/categorization-preview',
  authenticate,
  validate(categorizationPreviewSchema),
  asyncHandler(previewCategorizationHandler)
);
router.post(
  '/bulk-recategorize',
  authenticate,
  validate(bulkRecategorizeSchema),
  asyncHandler(bulkRecategorizeImportedTransactionsHandler)
);
router.patch(
  '/:id/category',
  authenticate,
  validate(transactionCategorySchema),
  asyncHandler(recategorizeImportedTransactionHandler)
);
router.post(
  '/:id/unlink',
  authenticate,
  validate(transactionIdParamSchema),
  asyncHandler(unlinkImportedTransactionHandler)
);
router.post(
  '/:id/convert-to-manual',
  authenticate,
  validate(transactionIdParamSchema),
  asyncHandler(convertImportedTransactionToManualHandler)
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
