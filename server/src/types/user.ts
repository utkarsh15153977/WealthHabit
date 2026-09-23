import { Role, AccountStatus } from '@prisma/client';

export interface FinancialProfileData {
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
  financialProfile: FinancialProfileData;
}

export interface ProfileData {
  profile: UserProfile;
}
