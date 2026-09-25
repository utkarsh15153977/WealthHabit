import { Router } from 'express';
import {
  deleteNotificationHandler,
  generateNotificationsHandler,
  getUnreadCountHandler,
  listNotificationsHandler,
  markAllNotificationsReadHandler,
  markNotificationReadHandler,
} from '../controllers/notificationController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  listNotificationsSchema,
  notificationIdParamSchema,
} from '../schemas/notificationSchemas.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get(
  '/',
  authenticate,
  validate(listNotificationsSchema),
  asyncHandler(listNotificationsHandler)
);
router.get('/unread-count', authenticate, asyncHandler(getUnreadCountHandler));
router.post('/generate', authenticate, asyncHandler(generateNotificationsHandler));
router.patch('/read-all', authenticate, asyncHandler(markAllNotificationsReadHandler));
router.patch(
  '/:id/read',
  authenticate,
  validate(notificationIdParamSchema),
  asyncHandler(markNotificationReadHandler)
);
router.delete(
  '/:id',
  authenticate,
  validate(notificationIdParamSchema),
  asyncHandler(deleteNotificationHandler)
);

export default router;
