import { AccountStatus, Role } from '@prisma/client';

export interface AdminUserSummary {
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

export interface AdminUserListResult {
  users: AdminUserSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminUserDetail {
  user: AdminUserSummary;
  counts: AdminUserCounts;
}
