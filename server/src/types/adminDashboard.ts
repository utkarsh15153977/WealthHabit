export interface AdminUserMetrics {
  total: number;
  active: number;
  suspended: number;
  deactivated: number;
  admins: number;
  recentlyRegistered: number;
}

export interface AdminFinancialRecordMetrics {
  transactions: number;
  savingsGoals: number;
  assets: number;
  liabilities: number;
  wealthSnapshots: number;
}

export interface AdminApplicationMetrics {
  habits: number;
  challenges: number;
  notifications: number;
}

export interface AdminDashboardData {
  users: AdminUserMetrics;
  financialRecords: AdminFinancialRecordMetrics;
  application: AdminApplicationMetrics;
  generatedAt: string;
}