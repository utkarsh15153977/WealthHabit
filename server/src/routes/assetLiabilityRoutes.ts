import { Router } from 'express';
import {
  createAssetHandler,
  createLiabilityHandler,
  deleteAssetHandler,
  deleteLiabilityHandler,
  getAssetHandler,
  getAssetsLiabilitiesSummaryHandler,
  getLiabilityHandler,
  listAssetsHandler,
  listLiabilitiesHandler,
  updateAssetHandler,
  updateLiabilityHandler,
} from '../controllers/assetLiabilityController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  assetIdParamSchema,
  createAssetSchema,
  createLiabilitySchema,
  liabilityIdParamSchema,
  listAssetsSchema,
  listLiabilitiesSchema,
  updateAssetSchema,
  updateLiabilitySchema,
} from '../schemas/assetLiabilitySchemas.js';

export const assetRouter = Router();

assetRouter.get(
  '/',
  authenticate,
  validate(listAssetsSchema),
  asyncHandler(listAssetsHandler)
);
assetRouter.post(
  '/',
  authenticate,
  validate(createAssetSchema),
  asyncHandler(createAssetHandler)
);
assetRouter.get(
  '/:id',
  authenticate,
  validate(assetIdParamSchema),
  asyncHandler(getAssetHandler)
);
assetRouter.patch(
  '/:id',
  authenticate,
  validate(assetIdParamSchema),
  validate(updateAssetSchema),
  asyncHandler(updateAssetHandler)
);
assetRouter.delete(
  '/:id',
  authenticate,
  validate(assetIdParamSchema),
  asyncHandler(deleteAssetHandler)
);

export const liabilityRouter = Router();

liabilityRouter.get(
  '/',
  authenticate,
  validate(listLiabilitiesSchema),
  asyncHandler(listLiabilitiesHandler)
);
liabilityRouter.post(
  '/',
  authenticate,
  validate(createLiabilitySchema),
  asyncHandler(createLiabilityHandler)
);
liabilityRouter.get(
  '/:id',
  authenticate,
  validate(liabilityIdParamSchema),
  asyncHandler(getLiabilityHandler)
);
liabilityRouter.patch(
  '/:id',
  authenticate,
  validate(liabilityIdParamSchema),
  validate(updateLiabilitySchema),
  asyncHandler(updateLiabilityHandler)
);
liabilityRouter.delete(
  '/:id',
  authenticate,
  validate(liabilityIdParamSchema),
  asyncHandler(deleteLiabilityHandler)
);

export const summaryRouter = Router();

summaryRouter.get(
  '/summary',
  authenticate,
  asyncHandler(getAssetsLiabilitiesSummaryHandler)
);
