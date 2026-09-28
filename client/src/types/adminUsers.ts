import type { AccountStatus, Role } from './auth';

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: AccountStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserCounts {
  transactions: number;
  goals: number;
  assets: number;
  liabilities: number;
  habits: number;
  challenges: number;
}

export interface AdminUserListResponse {
  users: AdminUser[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminUserDetailResponse {
  user: AdminUser;
  counts: AdminUserCounts;
}

export interface AdminUserListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: Role;
  status?: AccountStatus;
}
