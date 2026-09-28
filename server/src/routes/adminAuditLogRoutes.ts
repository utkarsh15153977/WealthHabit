import { Router } from 'express';
import { listAuditLogsHandler } from '../controllers/adminAuditLogController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/rbacMiddleware.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { listAuditLogsSchema } from '../schemas/adminAuditLogSchemas.js';

const router = Router();

/**
 * Audit-log management is read-only: this router intentionally exposes no
 * POST/PUT/PATCH/DELETE handlers, so audit records cannot be created,
 * modified or deleted through the application. There is also no
 * audit-of-audit-view entry — reads never write.
 */
router.get(
  '/audit-logs',
  authenticate,
  requireAdmin,
  validate(listAuditLogsSchema),
  asyncHandler(listAuditLogsHandler)
);

export default router;
