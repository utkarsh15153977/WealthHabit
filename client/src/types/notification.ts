export type NotificationType =
  | 'BUDGET_THRESHOLD'
  | 'BILL_UPCOMING'
  | 'BILL_OVERDUE'
  | 'SUBSCRIPTION_UPCOMING'
  | 'RECURRING_TRANSACTION_UPCOMING'
  | 'HABIT_REMINDER';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface NotificationListParams {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}

export interface NotificationListResponse {
  items: Notification[];
  page: number;
  pageSize: number;
  total: number;
  unreadCount: number;
}

export interface UnreadCountResponse {
  unreadCount: number;
}

export interface GenerateNotificationsResponse {
  created: number;
}

export interface NotificationResponse {
  notification: Notification;
}

export interface MarkAllReadResponse {
  updated: number;
}
