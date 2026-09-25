export type CategoryType = 'INCOME' | 'EXPENSE';
export type BillFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type BillStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type ObligationDueState = 'UPCOMING' | 'DUE' | 'OVERDUE' | null;

export interface BillCategorySummary {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}

export interface Bill {
  id: string;
  name: string;
  categoryId: string | null;
  category: BillCategorySummary | null;
  amount: number;
  frequency: BillFrequency;
  dueDate: string;
  nextDueDate: string;
  status: BillStatus;
  dueState: ObligationDueState;
  autoPay: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BillListResponse {
  bills: Bill[];
}

export interface BillResponse {
  bill: Bill;
}

export interface CreateBillRequest {
  name: string;
  categoryId?: string | null;
  amount: string;
  frequency: BillFrequency;
  dueDate: string;
  nextDueDate?: string;
  status?: BillStatus;
  autoPay?: boolean;
}

export interface UpdateBillRequest {
  name?: string;
  categoryId?: string | null;
  amount?: string;
  frequency?: BillFrequency;
  dueDate?: string;
  nextDueDate?: string;
  status?: BillStatus;
  autoPay?: boolean;
}

export interface BillListParams {
  status?: BillStatus;
  month?: string;
  active?: boolean;
}
