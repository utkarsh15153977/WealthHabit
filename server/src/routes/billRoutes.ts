import { Router } from 'express';
import {
  createBillHandler,
  deleteBillHandler,
  getBillHandler,
  listBillsHandler,
  updateBillHandler,
} from '../controllers/billController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  billIdParamSchema,
  createBillSchema,
  listBillsSchema,
  updateBillSchema,
} from '../schemas/billSchemas.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get(
  '/',
  authenticate,
  validate(listBillsSchema),
  asyncHandler(listBillsHandler)
);
router.post(
  '/',
  authenticate,
  validate(createBillSchema),
  asyncHandler(createBillHandler)
);
router.get(
  '/:id',
  authenticate,
  validate(billIdParamSchema),
  asyncHandler(getBillHandler)
);
router.patch(
  '/:id',
  authenticate,
  validate(billIdParamSchema),
  validate(updateBillSchema),
  asyncHandler(updateBillHandler)
);
router.delete(
  '/:id',
  authenticate,
  validate(billIdParamSchema),
  asyncHandler(deleteBillHandler)
);

export default router;
