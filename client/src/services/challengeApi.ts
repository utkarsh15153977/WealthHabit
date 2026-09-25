import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  ChallengeListParams,
  ChallengeListResponse,
  ChallengeProgress,
  ChallengeResponse,
  CreateChallengePayload,
  JoinChallengeResponse,
  LeaveChallengeResponse,
  MapChallengeHabitResponse,
  UpdateChallengePayload,
} from '../types/challenge';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getChallenges(
  params: ChallengeListParams = {}
): Promise<ChallengeListResponse> {
  const query: Record<string, string> = {};
  if (params.page !== undefined) query.page = String(params.page);
  if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);
  if (params.active !== undefined) query.active = String(params.active);
  if (params.status !== undefined) query.status = params.status;
  if (params.joined !== undefined) query.joined = String(params.joined);
  if (params.includeProgress !== undefined) {
    query.includeProgress = String(params.includeProgress);
  }

  const response = await api.get<ApiResponse<ChallengeListResponse>>('/challenges', {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return unwrapData(response.data);
}

export async function getChallenge(id: string): Promise<ChallengeResponse> {
  const response = await api.get<ApiResponse<ChallengeResponse>>(
    `/challenges/${id}`
  );
  return unwrapData(response.data);
}

export async function createChallenge(
  payload: CreateChallengePayload
): Promise<ChallengeResponse> {
  const response = await api.post<ApiResponse<ChallengeResponse>>(
    '/challenges',
    payload
  );
  return unwrapData(response.data);
}

export async function updateChallenge(
  id: string,
  payload: UpdateChallengePayload
): Promise<ChallengeResponse> {
  const response = await api.patch<ApiResponse<ChallengeResponse>>(
    `/challenges/${id}`,
    payload
  );
  return unwrapData(response.data);
}

export async function deleteChallenge(
  id: string
): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(
    `/challenges/${id}`
  );
  return unwrapData(response.data);
}

export async function joinChallenge(id: string): Promise<JoinChallengeResponse> {
  const response = await api.post<ApiResponse<JoinChallengeResponse>>(
    `/challenges/${id}/join`
  );
  return unwrapData(response.data);
}

export async function leaveChallenge(
  id: string
): Promise<LeaveChallengeResponse> {
  const response = await api.delete<ApiResponse<LeaveChallengeResponse>>(
    `/challenges/${id}/leave`
  );
  return unwrapData(response.data);
}

export async function getChallengeProgress(
  id: string
): Promise<ChallengeProgress> {
  const response = await api.get<ApiResponse<ChallengeProgress>>(
    `/challenges/${id}/progress`
  );
  return unwrapData(response.data);
}

export async function mapChallengeHabit(
  challengeId: string,
  requirementId: string,
  habitId: string
): Promise<MapChallengeHabitResponse> {
  const response = await api.post<ApiResponse<MapChallengeHabitResponse>>(
    `/challenges/${challengeId}/requirements/${requirementId}/habit`,
    { habitId }
  );
  return unwrapData(response.data);
}

export const challengeApi = {
  getChallenges,
  getChallenge,
  createChallenge,
  updateChallenge,
  deleteChallenge,
  joinChallenge,
  leaveChallenge,
  getChallengeProgress,
  mapChallengeHabit,
};
