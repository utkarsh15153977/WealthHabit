import { NotificationType } from '@prisma/client';

export interface NotificationData {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
  metadata: Record<string, unknown> | null;
}

export interface NotificationListData {
  items: NotificationData[];
  page: number;
  pageSize: number;
  total: number;
  unreadCount: number;
}

export interface UnreadCountData {
  unreadCount: number;
}

export interface GenerateNotificationsData {
  created: number;
}

export interface NotificationResponse {
  notification: NotificationData;
}

export interface MarkAllReadData {
  updated: number;
}
