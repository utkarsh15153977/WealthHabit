import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  CreateTransactionRequest,
  TransactionListParams,
  TransactionListResponse,
  TransactionResponse,
  UpdateTransactionRequest,
} from '../types/transaction';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

function buildListParams(params: TransactionListParams): Record<string, string | number> {
  const query: Record<string, string | number> = {};

  if (params.type) query.type = params.type;
  if (params.categoryId) query.categoryId = params.categoryId;
  if (params.dateFrom) query.dateFrom = params.dateFrom;
  if (params.dateTo) query.dateTo = params.dateTo;
  if (params.search) query.search = params.search;
  if (params.page !== undefined) query.page = params.page;
  if (params.limit !== undefined) query.limit = params.limit;

  return query;
}

export async function getTransactions(
  params: TransactionListParams = {}
): Promise<TransactionListResponse> {
  const response = await api.get<ApiResponse<TransactionListResponse>>('/transactions', {
    params: buildListParams(params),
  });
  return unwrapData(response.data);
}

export async function getTransaction(id: string): Promise<TransactionResponse> {
  const response = await api.get<ApiResponse<TransactionResponse>>(`/transactions/${id}`);
  return unwrapData(response.data);
}

export async function createTransaction(
  data: CreateTransactionRequest
): Promise<TransactionResponse> {
  const response = await api.post<ApiResponse<TransactionResponse>>('/transactions', data);
  return unwrapData(response.data);
}

export async function updateTransaction(
  id: string,
  data: UpdateTransactionRequest
): Promise<TransactionResponse> {
  const response = await api.patch<ApiResponse<TransactionResponse>>(`/transactions/${id}`, data);
  return unwrapData(response.data);
}

export async function deleteTransaction(id: string): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(`/transactions/${id}`);
  return unwrapData(response.data);
}

export const transactionApi = {
  getTransactions,
  getTransaction,
  createTransaction,
  updateTransaction,
  deleteTransaction,
};
