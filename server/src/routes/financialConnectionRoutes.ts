import { Router } from 'express';
import {
  createFinancialConnection,
  listFinancialConnections,
  getFinancialConnection,
  disconnectFinancialConnection,
  listFinancialAccounts,
  getFinancialAccount,
  syncFinancialAccountHandler,
  getFinancialAccountSyncSummaryHandler,
} from '../controllers/financialConnectionController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  createFinancialConnectionSchema,
  connectionIdParamSchema,
  accountIdParamSchema,
  listFinancialAccountsSchema,
  syncFinancialAccountSchema,
} from '../schemas/financialConnectionSchemas.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/', authenticate, asyncHandler(listFinancialConnections));
router.post('/', authenticate, validate(createFinancialConnectionSchema), asyncHandler(createFinancialConnection));
router.get('/:id', authenticate, validate(connectionIdParamSchema), asyncHandler(getFinancialConnection));
router.delete('/:id', authenticate, validate(connectionIdParamSchema), asyncHandler(disconnectFinancialConnection));

const accountsRouter = Router();
accountsRouter.get('/', authenticate, validate(listFinancialAccountsSchema), asyncHandler(listFinancialAccounts));
accountsRouter.get('/:id', authenticate, validate(accountIdParamSchema), asyncHandler(getFinancialAccount));
accountsRouter.post(
  '/:id/sync',
  authenticate,
  validate(syncFinancialAccountSchema),
  asyncHandler(syncFinancialAccountHandler)
);
accountsRouter.get(
  '/:id/sync-summary',
  authenticate,
  validate(accountIdParamSchema),
  asyncHandler(getFinancialAccountSyncSummaryHandler)
);

export const financialConnectionRouter = router;
export const financialAccountRouter = accountsRouter;
