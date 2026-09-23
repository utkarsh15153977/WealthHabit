import { Router } from 'express';
import {
  createCategoryHandler,
  deleteCategoryHandler,
  listCategories,
  updateCategoryHandler,
} from '../controllers/categoryController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  categoryIdParamSchema,
  createCategorySchema,
  listCategoriesSchema,
  updateCategorySchema,
} from '../schemas/categorySchemas.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/', authenticate, validate(listCategoriesSchema), asyncHandler(listCategories));
router.post('/', authenticate, validate(createCategorySchema), asyncHandler(createCategoryHandler));
router.patch(
  '/:id',
  authenticate,
  validate(categoryIdParamSchema),
  validate(updateCategorySchema),
  asyncHandler(updateCategoryHandler)
);
router.delete(
  '/:id',
  authenticate,
  validate(categoryIdParamSchema),
  asyncHandler(deleteCategoryHandler)
);

export default router;
