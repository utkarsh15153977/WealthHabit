import { Router } from 'express';
import {
  getFinancialReportCsvHandler,
  getFinancialReportHandler,
  getFinancialReportPdfHandler,
} from '../controllers/reportController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { financialReportQuerySchema } from '../schemas/reportSchemas.js';

/**
 * Reports are GET-only. There is no POST/PATCH/DELETE here, so generating a
 * report can never create or modify a transaction, asset, liability, goal,
 * budget, bill, subscription, snapshot or notification.
 *
 * All three endpoints take exactly the same validated query (strict, so
 * `?userId=` is a 400) and are resolved by the same report builder.
 */
export const reportRouter = Router();

reportRouter.get(
  '/financial',
  authenticate,
  validate(financialReportQuerySchema),
  asyncHandler(getFinancialReportHandler)
);

reportRouter.get(
  '/financial.csv',
  authenticate,
  validate(financialReportQuerySchema),
  asyncHandler(getFinancialReportCsvHandler)
);

reportRouter.get(
  '/financial.pdf',
  authenticate,
  validate(financialReportQuerySchema),
  asyncHandler(getFinancialReportPdfHandler)
);
