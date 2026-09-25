import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  BudgetListParams,
  BudgetListResponse,
  BudgetProgress,
  BudgetProgressResponse,
  BudgetResponse,
  BudgetWithProgress,
  BudgetWithProgressResponse,
  CreateBudgetRequest,
  UpdateBudgetRequest,
} from '../types/budget';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getBudgets(params: BudgetListParams = {}): Promise<BudgetListResponse> {
  const query: Record<string, string> = {};
  if (params.month) query.month = params.month;

  const response = await api.get<ApiResponse<BudgetListResponse>>('/budgets', {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return unwrapData(response.data);
}

export async function getBudget(id: string): Promise<BudgetWithProgress> {
  const response = await api.get<ApiResponse<BudgetWithProgressResponse>>(`/budgets/${id}`);
  return unwrapData(response.data).budget;
}

export async function getBudgetProgress(id: string): Promise<BudgetProgress> {
  const response = await api.get<ApiResponse<BudgetProgressResponse>>(`/budgets/${id}/progress`);
  return unwrapData(response.data).progress;
}

export async function createBudget(data: CreateBudgetRequest): Promise<BudgetResponse> {
  const response = await api.post<ApiResponse<BudgetResponse>>('/budgets', data);
  return unwrapData(response.data);
}

export async function updateBudget(
  id: string,
  data: UpdateBudgetRequest
): Promise<BudgetResponse> {
  const response = await api.patch<ApiResponse<BudgetResponse>>(`/budgets/${id}`, data);
  return unwrapData(response.data);
}

export async function deleteBudget(id: string): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(`/budgets/${id}`);
  return unwrapData(response.data);
}

export const budgetApi = {
  getBudgets,
  getBudget,
  getBudgetProgress,
  createBudget,
  updateBudget,
  deleteBudget,
};
