import type { AccountStatus, Role } from './auth';

export interface FinancialProfile {
  currency: string;
  monthlyIncomeTarget: number | null;
  monthlySavingsTarget: number | null;
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: AccountStatus;
  financialProfile: FinancialProfile;
}

export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  currency?: string;
  monthlyIncomeTarget?: number | null;
  monthlySavingsTarget?: number | null;
}

export interface ProfileResponse {
  profile: UserProfile;
}
