import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  CreateRecurringTransactionRequest,
  GenerateOccurrencesResponse,
  RecurringTransaction,
  RecurringTransactionListResponse,
  RecurringTransactionResponse,
  UpdateRecurringTransactionRequest,
} from '../types/recurringTransaction';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getRecurringTransactions(params: {
  isActive?: boolean;
} = {}): Promise<RecurringTransactionListResponse> {
  const query: Record<string, string> = {};
  if (params.isActive !== undefined) query.isActive = String(params.isActive);

  const response = await api.get<ApiResponse<RecurringTransactionListResponse>>(
    '/recurring-transactions',
    {
      params: Object.keys(query).length > 0 ? query : undefined,
    }
  );
  return unwrapData(response.data);
}

export async function getRecurringTransaction(
  id: string
): Promise<RecurringTransaction> {
  const response = await api.get<ApiResponse<RecurringTransactionResponse>>(
    `/recurring-transactions/${id}`
  );
  return unwrapData(response.data).recurringTransaction;
}

export async function createRecurringTransaction(
  data: CreateRecurringTransactionRequest
): Promise<RecurringTransactionResponse> {
  const response = await api.post<ApiResponse<RecurringTransactionResponse>>(
    '/recurring-transactions',
    data
  );
  return unwrapData(response.data);
}

export async function updateRecurringTransaction(
  id: string,
  data: UpdateRecurringTransactionRequest
): Promise<RecurringTransactionResponse> {
  const response = await api.patch<ApiResponse<RecurringTransactionResponse>>(
    `/recurring-transactions/${id}`,
    data
  );
  return unwrapData(response.data);
}

export async function deleteRecurringTransaction(
  id: string
): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(
    `/recurring-transactions/${id}`
  );
  return unwrapData(response.data);
}

export async function generateOccurrences(
  id: string
): Promise<GenerateOccurrencesResponse> {
  const response = await api.post<ApiResponse<GenerateOccurrencesResponse>>(
    `/recurring-transactions/${id}/generate`
  );
  return unwrapData(response.data);
}

export const recurringTransactionApi = {
  getRecurringTransactions,
  getRecurringTransaction,
  createRecurringTransaction,
  updateRecurringTransaction,
  deleteRecurringTransaction,
  generateOccurrences,
};
