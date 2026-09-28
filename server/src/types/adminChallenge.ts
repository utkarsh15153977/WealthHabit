import type {
  ChallengeDifficultyData,
  ChallengeRequirementData,
  ChallengeStatusData,
  ChallengeTypeData,
} from './challenge.js';

export interface AdminChallengeRequirementInfo {
  id: string;
  name: string;
  description: string | null;
  frequency: ChallengeRequirementData['frequency'];
  target: number;
  unit: string | null;
  mappedParticipants: number;
}

export interface AdminChallengeSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: ChallengeDifficultyData;
  points: number;
  type: ChallengeTypeData;
  startDate: string;
  endDate: string;
  isActive: boolean;
  status: ChallengeStatusData;
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

export interface AdminChallengeListResult {
  challenges: AdminChallengeSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
