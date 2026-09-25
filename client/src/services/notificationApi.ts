import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  GenerateNotificationsResponse,
  MarkAllReadResponse,
  NotificationListParams,
  NotificationListResponse,
  NotificationResponse,
  UnreadCountResponse,
} from '../types/notification';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getNotifications(
  params: NotificationListParams = {}
): Promise<NotificationListResponse> {
  const query: Record<string, string> = {};
  if (params.page !== undefined) query.page = String(params.page);
  if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);
  if (params.unreadOnly !== undefined) query.unreadOnly = String(params.unreadOnly);

  const response = await api.get<ApiResponse<NotificationListResponse>>('/notifications', {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return unwrapData(response.data);
}

export async function getUnreadCount(): Promise<UnreadCountResponse> {
  const response = await api.get<ApiResponse<UnreadCountResponse>>(
    '/notifications/unread-count'
  );
  return unwrapData(response.data);
}

export async function generateNotifications(): Promise<GenerateNotificationsResponse> {
  const response = await api.post<ApiResponse<GenerateNotificationsResponse>>(
    '/notifications/generate'
  );
  return unwrapData(response.data);
}

export async function markNotificationRead(id: string): Promise<NotificationResponse> {
  const response = await api.patch<ApiResponse<NotificationResponse>>(
    `/notifications/${id}/read`
  );
  return unwrapData(response.data);
}

export async function markAllNotificationsRead(): Promise<MarkAllReadResponse> {
  const response = await api.patch<ApiResponse<MarkAllReadResponse>>(
    '/notifications/read-all'
  );
  return unwrapData(response.data);
}

export async function deleteNotification(id: string): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(
    `/notifications/${id}`
  );
  return unwrapData(response.data);
}

export const notificationApi = {
  getNotifications,
  getUnreadCount,
  generateNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
};
