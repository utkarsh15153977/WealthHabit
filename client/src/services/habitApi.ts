import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  CompleteHabitResponse,
  CreateHabitPayload,
  HabitCompletionListParams,
  HabitCompletionListResponse,
  HabitListParams,
  HabitListResponse,
  HabitProgress,
  HabitProgressHistoryParams,
  HabitProgressHistoryResponse,
  HabitResponse,
  UncompleteHabitResponse,
  UpdateHabitPayload,
} from '../types/habit';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getHabits(params: HabitListParams = {}): Promise<HabitListResponse> {
  const query: Record<string, string> = {};
  if (params.page !== undefined) query.page = String(params.page);
  if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);
  if (params.active !== undefined) query.active = String(params.active);
  if (params.frequency !== undefined) query.frequency = params.frequency;
  if (params.includeProgress !== undefined) {
    query.includeProgress = String(params.includeProgress);
  }

  const response = await api.get<ApiResponse<HabitListResponse>>('/habits', {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return unwrapData(response.data);
}

export async function createHabit(payload: CreateHabitPayload): Promise<HabitResponse> {
  const response = await api.post<ApiResponse<HabitResponse>>('/habits', payload);
  return unwrapData(response.data);
}

export async function updateHabit(
  id: string,
  payload: UpdateHabitPayload
): Promise<HabitResponse> {
  const response = await api.patch<ApiResponse<HabitResponse>>(`/habits/${id}`, payload);
  return unwrapData(response.data);
}

export async function deleteHabit(id: string): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(`/habits/${id}`);
  return unwrapData(response.data);
}

export async function completeHabit(id: string): Promise<CompleteHabitResponse> {
  const response = await api.post<ApiResponse<CompleteHabitResponse>>(
    `/habits/${id}/complete`
  );
  return unwrapData(response.data);
}

export async function uncompleteHabit(id: string): Promise<UncompleteHabitResponse> {
  const response = await api.delete<ApiResponse<UncompleteHabitResponse>>(
    `/habits/${id}/complete`
  );
  return unwrapData(response.data);
}

export async function getHabitCompletions(
  id: string,
  params: HabitCompletionListParams = {}
): Promise<HabitCompletionListResponse> {
  const query: Record<string, string> = {};
  if (params.page !== undefined) query.page = String(params.page);
  if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);

  const response = await api.get<ApiResponse<HabitCompletionListResponse>>(
    `/habits/${id}/completions`,
    {
      params: Object.keys(query).length > 0 ? query : undefined,
    }
  );
  return unwrapData(response.data);
}

export async function getHabitProgress(id: string): Promise<HabitProgress> {
  const response = await api.get<ApiResponse<HabitProgress>>(`/habits/${id}/progress`);
  return unwrapData(response.data);
}

export async function getHabitProgressHistory(
  id: string,
  params: HabitProgressHistoryParams = {}
): Promise<HabitProgressHistoryResponse> {
  const query: Record<string, string> = {};
  if (params.page !== undefined) query.page = String(params.page);
  if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);

  const response = await api.get<ApiResponse<HabitProgressHistoryResponse>>(
    `/habits/${id}/progress/history`,
    {
      params: Object.keys(query).length > 0 ? query : undefined,
    }
  );
  return unwrapData(response.data);
}

export const habitApi = {
  getHabits,
  createHabit,
  updateHabit,
  deleteHabit,
  completeHabit,
  uncompleteHabit,
  getHabitCompletions,
  getHabitProgress,
  getHabitProgressHistory,
};
