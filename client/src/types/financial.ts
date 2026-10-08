export type FinancialConnectionProvider = 'MOCK';

export type FinancialConnectionStatus =
  | 'ACTIVE'
  | 'ERROR'
  | 'REVOKED'
  | 'DISCONNECTED';

export type FinancialAccountType =
  | 'SAVINGS'
  | 'CURRENT'
  | 'DEBIT_CARD'
  | 'CREDIT_CARD'
  | 'UPI_LINKED';

export type TransactionType = 'INCOME' | 'EXPENSE';

export type TransactionSource = 'MANUAL' | 'IMPORTED';

export interface FinancialAccount {
  id: string;
  externalAccountId: string;
  name: string;
  mask: string | null;
  type: FinancialAccountType;
  currency: string;
  institutionName: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialConnection {
  id: string;
  provider: FinancialConnectionProvider;
  status: FinancialConnectionStatus;
  institutionName: string | null;
  consentGivenAt: string | null;
  revokedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  accounts: FinancialAccount[];
  createdAt: string;
  updatedAt: string;
}

export interface FinancialSyncSummary {
  accountId: string;
  accountName: string;
  status: FinancialConnectionStatus;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  lastSync: {
    transactionsFetched: number;
    transactionsImported: number;
    transactionsSkipped: number;
    syncedAt: string;
  } | null;
}

export interface SyncResult {
  accountId: string;
  transactionsFetched: number;
  transactionsImported: number;
  transactionsSkipped: number;
  lastSyncedAt: string;
}

export interface CategorySummary {
  id: string;
  name: string;
  type: TransactionType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}

export interface ImportedTransactionAccountSummary {
  id: string;
  name: string;
  mask: string | null;
  type: FinancialAccountType;
  currency: string;
  institutionName: string | null;
}

export interface ImportedTransaction {
  id: string;
  amount: number;
  type: TransactionType;
  description: string | null;
  merchant: string | null;
  transactionDate: string;
  paymentMethod: string | null;
  paymentChannel: string | null;
  category: CategorySummary;
  financialAccountId: string | null;
  financialAccount: ImportedTransactionAccountSummary | null;
  source: TransactionSource;
  externalTransactionId: string | null;
  importedAt: string | null;
}

export interface ImportedTransactionList {
  transactions: ImportedTransaction[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ImportedTransactionFilters {
  type?: TransactionType;
  dateFrom?: string;
  dateTo?: string;
  categoryId?: string;
  financialAccountId?: string;
  page?: number;
  limit?: number;
}

export interface CategorizationPreview {
  category: CategorySummary;
  confidence: number;
  reason: CategorizationReason;
  matchedRule: string | null;
}

export type CategorizationReason =
  | 'MANUAL'
  | 'USER_RULE'
  | 'MERCHANT_RULE'
  | 'PAYMENT_CHANNEL_RULE'
  | 'DESCRIPTION_RULE'
  | 'EXISTING_CATEGORY'
  | 'DEFAULT_CATEGORY';

export interface CategorizationPreviewRequest {
  type: TransactionType;
  merchant?: string | null;
  description?: string | null;
  paymentMethod?: string | null;
  paymentChannel?: string | null;
}

export interface BulkRecategorizeRequest {
  transactionIds: string[];
  categoryId: string;
  rememberForMerchant?: boolean;
}

export interface BulkRecategorizeResult {
  transactionCount: number;
  categoryId: string;
}

export interface CategoryRule {
  id: string;
  merchant: string;
  categoryId: string;
  category: CategorySummary;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryRuleRequest {
  merchant: string;
  categoryId: string;
  isActive?: boolean;
}

export interface UpdateCategoryRuleRequest {
  merchant?: string;
  categoryId?: string;
  isActive?: boolean;
}
