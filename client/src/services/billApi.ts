import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  Bill,
  BillListParams,
  BillListResponse,
  BillResponse,
  CreateBillRequest,
  UpdateBillRequest,
} from '../types/bill';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function getBills(params: BillListParams = {}): Promise<BillListResponse> {
  const query: Record<string, string> = {};
  if (params.status) query.status = params.status;
  if (params.month) query.month = params.month;
  if (params.active !== undefined) query.active = String(params.active);

  const response = await api.get<ApiResponse<BillListResponse>>('/bills', {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return unwrapData(response.data);
}

export async function getBill(id: string): Promise<Bill> {
  const response = await api.get<ApiResponse<BillResponse>>(`/bills/${id}`);
  return unwrapData(response.data).bill;
}

export async function createBill(data: CreateBillRequest): Promise<BillResponse> {
  const response = await api.post<ApiResponse<BillResponse>>('/bills', data);
  return unwrapData(response.data);
}

export async function updateBill(
  id: string,
  data: UpdateBillRequest
): Promise<BillResponse> {
  const response = await api.patch<ApiResponse<BillResponse>>(`/bills/${id}`, data);
  return unwrapData(response.data);
}

export async function deleteBill(id: string): Promise<{ message: string }> {
  const response = await api.delete<ApiResponse<{ message: string }>>(`/bills/${id}`);
  return unwrapData(response.data);
}

export const billApi = {
  getBills,
  getBill,
  createBill,
  updateBill,
  deleteBill,
};
