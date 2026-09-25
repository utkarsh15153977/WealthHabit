export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'CANCELLED';
export type GoalPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Goal {
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
  targetDate: string;
  overdue: boolean;
  monthlyContribution: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalContribution {
  id: string;
  goalId: string;
  amount: number;
  contributionDate: string;
  note: string | null;
  createdAt: string;
}

export interface GoalProgress {
  goalId: string;
  targetAmount: number;
  currentAmount: number;
  remainingAmount: number;
  progressPercent: number;
  contributionCount: number;
  targetDate: string;
  status: GoalStatus;
  overdue: boolean;
}

export interface GoalListParams {
  page?: number;
  pageSize?: number;
  status?: GoalStatus;
}

export interface GoalListResponse {
  goals: Goal[];
  page: number;
  pageSize: number;
  total: number;
  activeCount: number;
  totalTargetAmount: number;
  totalSavedAmount: number;
  nearestTargetDate: string | null;
}

export interface GoalContributionListParams {
  page?: number;
  pageSize?: number;
}

export interface GoalContributionListResponse {
  contributions: GoalContribution[];
  page: number;
  pageSize: number;
  total: number;
}

export interface GoalResponse {
  goal: Goal;
}

export interface GoalProgressResponse {
  progress: GoalProgress;
}

export interface GoalContributionResponse {
  contribution: GoalContribution;
}

export interface CreateGoalRequest {
  name: string;
  targetAmount: string;
  targetDate: string;
  description?: string;
  category?: string;
  priority?: GoalPriority;
  monthlyContribution?: string | null;
}

export interface UpdateGoalRequest {
  name?: string;
  description?: string | null;
  targetAmount?: string;
  targetDate?: string;
  category?: string;
  priority?: GoalPriority;
  status?: Exclude<GoalStatus, 'COMPLETED'>;
  monthlyContribution?: string | null;
}

export interface CreateContributionRequest {
  amount: string;
  contributionDate?: string;
  note?: string;
}

export interface UpdateContributionRequest {
  amount?: string;
  contributionDate?: string;
  note?: string | null;
}
