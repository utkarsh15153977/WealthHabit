import type { ChallengeDifficulty, ChallengeStatus, ChallengeType } from './challenge';
import type { HabitFrequency } from './habit';

export interface AdminChallengeRequirementInfo {
  id: string;
  name: string;
  description: string | null;
  frequency: HabitFrequency;
  target: number;
  unit: string | null;
  mappedParticipants: number;
}

export interface AdminChallengeSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: ChallengeDifficulty;
  points: number;
  type: ChallengeType;
  startDate: string;
  endDate: string;
  isActive: boolean;
  status: ChallengeStatus;
  createdAt: string;
  updatedAt: string;
  requirementCount: number;
  participants: {
    total: number;
  };
}

export interface AdminChallengeDetail extends Omit<AdminChallengeSummary, 'participants'> {
  requirements: AdminChallengeRequirementInfo[];
  participants: {
    total: number;
    completed: number;
  };
}

export interface AdminChallengeListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: ChallengeType;
  status?: ChallengeStatus;
  active?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface AdminChallengeListResponse {
  challenges: AdminChallengeSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const CHALLENGE_TYPES: ChallengeType[] = ['HABIT_COMPLETION'];

export const CHALLENGE_STATUSES: ChallengeStatus[] = [
  'UPCOMING',
  'ACTIVE',
  'ENDED',
];
