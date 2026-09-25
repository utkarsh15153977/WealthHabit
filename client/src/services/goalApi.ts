import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  CreateContributionRequest,
  CreateGoalRequest,
  Goal,
  GoalContribution,
  GoalContributionListParams,
  GoalContributionListResponse,
  GoalContributionResponse,
  GoalListParams,
  GoalListResponse,
  GoalProgress,
  GoalProgressResponse,
  GoalResponse,
  UpdateContributionRequest,
  UpdateGoalRequest,
} from '../types/goal';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getGoals(params: GoalListParams = {}): Promise<GoalListResponse> {
  const query: Record<string, string> = {};
  if (params.page !== undefined) query.page = String(params.page);
  if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);
  if (params.status) query.status = params.status;

  const response = await api.get<ApiResponse<GoalListResponse>>('/goals', {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return unwrapData(response.data);
}

export async function getGoal(id: string): Promise<Goal> {
  const response = await api.get<ApiResponse<GoalResponse>>(`/goals/${id}`);
  return unwrapData(response.data).goal;
}

export async function getGoalProgress(id: string): Promise<GoalProgress> {
  const response = await api.get<ApiResponse<GoalProgressResponse>>(`/goals/${id}/progress`);
  return unwrapData(response.data).progress;
}

export async function createGoal(data: CreateGoalRequest): Promise<Goal> {
  const response = await api.post<ApiResponse<GoalResponse>>('/goals', data);
  return unwrapData(response.data).goal;
}

export async function updateGoal(id: string, data: UpdateGoalRequest): Promise<Goal> {
  const response = await api.patch<ApiResponse<GoalResponse>>(`/goals/${id}`, data);
  return unwrapData(response.data).goal;
}

export async function deleteGoal(id: string): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(`/goals/${id}`);
  return unwrapData(response.data);
}

export async function getGoalContributions(
  goalId: string,
  params: GoalContributionListParams = {}
): Promise<GoalContributionListResponse> {
  const query: Record<string, string> = {};
  if (params.page !== undefined) query.page = String(params.page);
  if (params.pageSize !== undefined) query.pageSize = String(params.pageSize);

  const response = await api.get<ApiResponse<GoalContributionListResponse>>(
    `/goals/${goalId}/contributions`,
    {
      params: Object.keys(query).length > 0 ? query : undefined,
    }
  );
  return unwrapData(response.data);
}

export async function createGoalContribution(
  goalId: string,
  data: CreateContributionRequest
): Promise<GoalContribution> {
  const response = await api.post<ApiResponse<GoalContributionResponse>>(
    `/goals/${goalId}/contributions`,
    data
  );
  return unwrapData(response.data).contribution;
}

export async function updateGoalContribution(
  goalId: string,
  contributionId: string,
  data: UpdateContributionRequest
): Promise<GoalContribution> {
  const response = await api.patch<ApiResponse<GoalContributionResponse>>(
    `/goals/${goalId}/contributions/${contributionId}`,
    data
  );
  return unwrapData(response.data).contribution;
}

export async function deleteGoalContribution(
  goalId: string,
  contributionId: string
): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(
    `/goals/${goalId}/contributions/${contributionId}`
  );
  return unwrapData(response.data);
}

export const goalApi = {
  getGoals,
  getGoal,
  getGoalProgress,
  createGoal,
  updateGoal,
  deleteGoal,
  getGoalContributions,
  createGoalContribution,
  updateGoalContribution,
  deleteGoalContribution,
};
