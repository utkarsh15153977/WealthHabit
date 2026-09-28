import { Router } from 'express';
import {
  getAdminUserHandler,
  listAdminUsersHandler,
  updateAdminUserRoleHandler,
  updateAdminUserStatusHandler,
} from '../controllers/adminUserController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/rbacMiddleware.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  adminUserIdParamSchema,
  listAdminUsersSchema,
  updateAdminUserRoleSchema,
  updateAdminUserStatusSchema,
} from '../schemas/adminUserSchemas.js';

const router = Router();

router.get(
  '/users',
  authenticate,
  requireAdmin,
  validate(listAdminUsersSchema),
  asyncHandler(listAdminUsersHandler)
);

router.get(
  '/users/:id',
  authenticate,
  requireAdmin,
  validate(adminUserIdParamSchema),
  asyncHandler(getAdminUserHandler)
);

router.patch(
  '/users/:id/status',
  authenticate,
  requireAdmin,
  validate(updateAdminUserStatusSchema),
  asyncHandler(updateAdminUserStatusHandler)
);

router.patch(
  '/users/:id/role',
  authenticate,
  requireAdmin,
  validate(updateAdminUserRoleSchema),
  asyncHandler(updateAdminUserRoleHandler)
);

export default router;
