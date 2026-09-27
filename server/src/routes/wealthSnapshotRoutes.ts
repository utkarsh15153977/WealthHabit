import { Router } from 'express';
import {
  createWealthSnapshotHandler,
  getWealthSnapshotHandler,
  listWealthSnapshotsHandler,
} from '../controllers/wealthSnapshotController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createWealthSnapshotSchema,
  listWealthSnapshotsSchema,
  wealthSnapshotIdParamSchema,
} from '../schemas/wealthSnapshotSchemas.js';

export const wealthSnapshotRouter = Router();

wealthSnapshotRouter.get(
  '/',
  authenticate,
  validate(listWealthSnapshotsSchema),
  asyncHandler(listWealthSnapshotsHandler)
);

wealthSnapshotRouter.post(
  '/',
  authenticate,
  validate(createWealthSnapshotSchema),
  asyncHandler(createWealthSnapshotHandler)
);

wealthSnapshotRouter.get(
  '/:id',
  authenticate,
  validate(wealthSnapshotIdParamSchema),
  asyncHandler(getWealthSnapshotHandler)
);
