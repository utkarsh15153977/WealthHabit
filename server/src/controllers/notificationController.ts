import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import { ListNotificationsQuery } from '../schemas/notificationSchemas.js';
import {
  countUnreadNotifications,
  deleteNotification,
  findUserNotification,
  generateNotificationsForUser,
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  toNotificationData,
} from '../services/prismaNotificationService.js';
import { AppError } from '../utils/errors.js';
import { ApiErrorCodes } from '../types/errorCodes.js';
import {
  GenerateNotificationsData,
  MarkAllReadData,
  NotificationListData,
  NotificationResponse,
  UnreadCountData,
} from '../types/notification.js';

function notificationNotFound(): AppError {
  return new AppError(
    'Notification not found',
    404,
    undefined,
    ApiErrorCodes.NOTIFICATION_NOT_FOUND
  );
}

export async function listNotificationsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const query = (req.query ?? {}) as ListNotificationsQuery;

  const result = await listUserNotifications(userId, query);

  const data: NotificationListData = {
    items: result.items.map(toNotificationData),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    unreadCount: result.unreadCount,
  };

  res.json({
    success: true,
    data,
  });
}

export async function getUnreadCountHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const data: UnreadCountData = {
    unreadCount: await countUnreadNotifications(userId),
  };

  res.json({
    success: true,
    data,
  });
}

export async function generateNotificationsHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const created = await generateNotificationsForUser(userId);

  const data: GenerateNotificationsData = { created };

  res.json({
    success: true,
    data,
  });
}

export async function markNotificationReadHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await findUserNotification(id, userId);
  if (!existing) {
    throw notificationNotFound();
  }

  const notification = await markNotificationRead(existing);

  const data: NotificationResponse = {
    notification: toNotificationData(notification),
  };

  res.json({
    success: true,
    data,
  });
}

export async function markAllNotificationsReadHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const updated = await markAllNotificationsRead(userId);

  const data: MarkAllReadData = { updated };

  res.json({
    success: true,
    data,
  });
}

export async function deleteNotificationHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const { id } = req.params as { id: string };

  const existing = await findUserNotification(id, userId);
  if (!existing) {
    throw notificationNotFound();
  }

  await deleteNotification(existing.id);

  res.json({
    success: true,
    data: { message: 'Notification deleted' },
  });
}
