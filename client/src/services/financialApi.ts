import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  BulkRecategorizeRequest,
  BulkRecategorizeResult,
  CategorizationPreview,
  CategorizationPreviewRequest,
  CategoryRule,
  CreateCategoryRuleRequest,
  FinancialAccount,
  FinancialConnection,
  FinancialSyncSummary,
  ImportedTransaction,
  ImportedTransactionFilters,
  ImportedTransactionList,
  SyncResult,
  UpdateCategoryRuleRequest,
} from '../types/financial';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

export async function listFinancialConnections(): Promise<FinancialConnection[]> {
  const response = await api.get<ApiResponse<FinancialConnection[]>>('/financial-connections');
  return unwrapData(response.data);
}

export async function createMockFinancialConnection(): Promise<FinancialConnection> {
  const response = await api.post<ApiResponse<FinancialConnection>>('/financial-connections', {
    provider: 'MOCK',
  });
  return unwrapData(response.data);
}

export async function getFinancialConnection(id: string): Promise<FinancialConnection> {
  const response = await api.get<ApiResponse<FinancialConnection>>(`/financial-connections/${id}`);
  return unwrapData(response.data);
}

export async function disconnectFinancialConnection(id: string): Promise<void> {
  await api.delete<ApiResponse<unknown>>(`/financial-connections/${id}`);
}

export async function listFinancialAccounts(connectionId?: string): Promise<FinancialAccount[]> {
  const response = await api.get<ApiResponse<{ accounts: FinancialAccount[] }>>(
    '/financial-accounts',
    { params: connectionId ? { connectionId } : undefined }
  );
  return unwrapData(response.data).accounts;
}

export async function getFinancialAccount(id: string): Promise<FinancialAccount> {
  const response = await api.get<ApiResponse<FinancialAccount>>(`/financial-accounts/${id}`);
  return unwrapData(response.data);
}

export async function syncFinancialAccount(
  id: string,
  from?: string,
  to?: string
): Promise<SyncResult> {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;

  const response = await api.post<ApiResponse<SyncResult>>(
    `/financial-accounts/${id}/sync`,
    {},
    { params: Object.keys(params).length > 0 ? params : undefined }
  );
  return unwrapData(response.data);
}

export async function getFinancialSyncSummary(id: string): Promise<FinancialSyncSummary> {
  const response = await api.get<ApiResponse<FinancialSyncSummary>>(
    `/financial-accounts/${id}/sync-summary`
  );
  return unwrapData(response.data);
}

export async function listImportedTransactions(
  filters: ImportedTransactionFilters = {}
): Promise<ImportedTransactionList> {
  const query: Record<string, string | number> = {};
  if (filters.type) query.type = filters.type;
  if (filters.dateFrom) query.dateFrom = filters.dateFrom;
  if (filters.dateTo) query.dateTo = filters.dateTo;
  if (filters.categoryId) query.categoryId = filters.categoryId;
  if (filters.financialAccountId) query.financialAccountId = filters.financialAccountId;
  if (filters.page !== undefined) query.page = filters.page;
  if (filters.limit !== undefined) query.limit = filters.limit;

  const response = await api.get<ApiResponse<ImportedTransactionList>>('/transactions/imported', {
    params: Object.keys(query).length > 0 ? query : undefined,
  });
  return unwrapData(response.data);
}

export async function recategorizeImportedTransaction(
  id: string,
  categoryId: string,
  rememberForMerchant = false
): Promise<ImportedTransaction> {
  const response = await api.patch<ApiResponse<{ transaction: ImportedTransaction }>>(
    `/transactions/${id}/category`,
    { categoryId, rememberForMerchant }
  );
  return unwrapData(response.data).transaction;
}

export async function unlinkImportedTransaction(id: string): Promise<ImportedTransaction> {
  const response = await api.post<ApiResponse<{ transaction: ImportedTransaction }>>(
    `/transactions/${id}/unlink`
  );
  return unwrapData(response.data).transaction;
}

export async function convertImportedTransactionToManual(
  id: string
): Promise<ImportedTransaction> {
  const response = await api.post<ApiResponse<{ transaction: ImportedTransaction }>>(
    `/transactions/${id}/convert-to-manual`
  );
  return unwrapData(response.data).transaction;
}

export async function previewCategorization(
  data: CategorizationPreviewRequest
): Promise<CategorizationPreview> {
  const response = await api.post<ApiResponse<CategorizationPreview>>(
    '/transactions/categorization-preview',
    data
  );
  return unwrapData(response.data);
}

export async function bulkRecategorize(
  data: BulkRecategorizeRequest
): Promise<BulkRecategorizeResult> {
  const response = await api.post<ApiResponse<BulkRecategorizeResult>>(
    '/transactions/bulk-recategorize',
    data
  );
  return unwrapData(response.data);
}

export async function listCategoryRules(): Promise<CategoryRule[]> {
  const response = await api.get<ApiResponse<{ rules: CategoryRule[] }>>(
    '/transaction-category-rules'
  );
  return unwrapData(response.data).rules;
}

export async function createCategoryRule(
  data: CreateCategoryRuleRequest
): Promise<CategoryRule> {
  const response = await api.post<ApiResponse<{ rule: CategoryRule }>>(
    '/transaction-category-rules',
    data
  );
  return unwrapData(response.data).rule;
}

export async function updateCategoryRule(
  id: string,
  data: UpdateCategoryRuleRequest
): Promise<CategoryRule> {
  const response = await api.patch<ApiResponse<{ rule: CategoryRule }>>(
    `/transaction-category-rules/${id}`,
    data
  );
  return unwrapData(response.data).rule;
}

export async function deleteCategoryRule(id: string): Promise<{ ruleId: string; deleted: boolean }> {
  const response = await api.delete<ApiResponse<{ ruleId: string; deleted: boolean }>>(
    `/transaction-category-rules/${id}`
  );
  return unwrapData(response.data);
}

export const financialApi = {
  listFinancialConnections,
  createMockFinancialConnection,
  getFinancialConnection,
  disconnectFinancialConnection,
  listFinancialAccounts,
  getFinancialAccount,
  syncFinancialAccount,
  getFinancialSyncSummary,
  listImportedTransactions,
  recategorizeImportedTransaction,
  unlinkImportedTransaction,
  convertImportedTransactionToManual,
  previewCategorization,
  bulkRecategorize,
  listCategoryRules,
  createCategoryRule,
  updateCategoryRule,
  deleteCategoryRule,
};
