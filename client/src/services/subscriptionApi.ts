import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  CreateSubscriptionRequest,
  Subscription,
  SubscriptionListParams,
  SubscriptionListResponse,
  SubscriptionResponse,
  UpdateSubscriptionRequest,
} from '../types/subscription';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getSubscriptions(
  params: SubscriptionListParams = {}
): Promise<SubscriptionListResponse> {
  const query: Record<string, string> = {};
  if (params.status) query.status = params.status;
  if (params.month) query.month = params.month;
  if (params.active !== undefined) query.active = String(params.active);

  const response = await api.get<ApiResponse<SubscriptionListResponse>>('/subscriptions', {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return unwrapData(response.data);
}

export async function getSubscription(id: string): Promise<Subscription> {
  const response = await api.get<ApiResponse<SubscriptionResponse>>(`/subscriptions/${id}`);
  return unwrapData(response.data).subscription;
}

export async function createSubscription(
  data: CreateSubscriptionRequest
): Promise<SubscriptionResponse> {
  const response = await api.post<ApiResponse<SubscriptionResponse>>('/subscriptions', data);
  return unwrapData(response.data);
}

export async function updateSubscription(
  id: string,
  data: UpdateSubscriptionRequest
): Promise<SubscriptionResponse> {
  const response = await api.patch<ApiResponse<SubscriptionResponse>>(
    `/subscriptions/${id}`,
    data
  );
  return unwrapData(response.data);
}

export async function renewSubscription(id: string): Promise<SubscriptionResponse> {
  const response = await api.post<ApiResponse<SubscriptionResponse>>(
    `/subscriptions/${id}/renew`
  );
  return unwrapData(response.data);
}

export async function deleteSubscription(id: string): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(
    `/subscriptions/${id}`
  );
  return unwrapData(response.data);
}

export const subscriptionApi = {
  getSubscriptions,
  getSubscription,
  createSubscription,
  updateSubscription,
  renewSubscription,
  deleteSubscription,
};
