import { GoalPriority, GoalStatus } from '@prisma/client';

export interface GoalData {
  id: string;
  name: string;
  description: string | null;
  category: string;
  priority: GoalPriority;
  status: GoalStatus;
  targetAmount: number;
  currentAmount: number;
  remainingAmount: number;
  progressPercent: number;
  contributionCount: number;
  targetDate: Date;
  overdue: boolean;
  monthlyContribution: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoalProgress {
  goalId: string;
  targetAmount: number;
  currentAmount: number;
  remainingAmount: number;
  progressPercent: number;
  contributionCount: number;
  targetDate: Date;
  status: GoalStatus;
  overdue: boolean;
}

export interface GoalContributionData {
  id: string;
  goalId: string;
  amount: number;
  contributionDate: Date;
  note: string | null;
  createdAt: Date;
}

export interface GoalListData {
  goals: GoalData[];
  page: number;
  pageSize: number;
  total: number;
  activeCount: number;
  totalTargetAmount: number;
  totalSavedAmount: number;
  nearestTargetDate: Date | null;
}

export interface GoalContributionListData {
  contributions: GoalContributionData[];
  page: number;
  pageSize: number;
  total: number;
}
