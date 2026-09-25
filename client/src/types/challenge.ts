import type { HabitFrequency } from './habit';

export type ChallengeType = 'HABIT_COMPLETION';

export type ChallengeDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type ChallengeStatus = 'UPCOMING' | 'ACTIVE' | 'ENDED';

export type ChallengeParticipantStatus = 'NOT_JOINED' | 'JOINED' | 'COMPLETED';

export interface ChallengeRequirement {
  id: string;
  challengeId: string;
  name: string;
  description: string | null;
  frequency: HabitFrequency;
  target: number;
  unit: string | null;
  createdAt: string;
}

export interface ChallengeRequirementProgress {
  requirementId: string;
  name: string;
  frequency: HabitFrequency;
  target: number;
  unit: string | null;
  mapped: boolean;
  habitId: string | null;
  completedPeriods: number;
  eligiblePeriods: number;
  completionRate: number;
}

export interface ChallengeProgress {
  challengeId: string;
  joined: true;
  status: 'JOINED' | 'COMPLETED';
  startDate: string;
  endDate: string;
  completedPeriods: number;
  eligiblePeriods: number;
  completionRate: number;
  completed: boolean;
  requirements: ChallengeRequirementProgress[];
}

export interface ChallengeParticipation {
  joined: boolean;
  joinedAt: string | null;
  status: ChallengeParticipantStatus;
  progress: ChallengeProgress | null;
}

export interface Challenge {
  id: string;
  name: string;
  description: string;
  type: ChallengeType;
  category: string;
  difficulty: ChallengeDifficulty;
  points: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  status: ChallengeStatus;
  createdAt: string;
  updatedAt: string;
  requirements: ChallengeRequirement[];
  participation: ChallengeParticipation;
}

export interface ChallengeListParams {
  page?: number;
  pageSize?: number;
  active?: boolean;
  status?: ChallengeStatus;
  joined?: boolean;
  includeProgress?: boolean;
}

export interface ChallengeListResponse {
  challenges: Challenge[];
  page: number;
  pageSize: number;
  total: number;
  activeCount: number;
  joinedCount: number;
}

export interface ChallengeResponse {
  challenge: Challenge;
}

export interface JoinChallengeResponse {
  challengeId: string;
  joined: true;
  alreadyJoined: boolean;
}

export interface LeaveChallengeResponse {
  challengeId: string;
  left: true;
  wasJoined: boolean;
}

export interface MapChallengeHabitResponse {
  mapping: {
    requirementId: string;
    habitId: string;
  };
}

export interface CreateChallengeRequirementPayload {
  name: string;
  description?: string;
  frequency: HabitFrequency;
  target?: number;
  unit?: string;
}

export interface CreateChallengePayload {
  name: string;
  description?: string;
  category?: string;
  difficulty?: ChallengeDifficulty;
  points?: number;
  startDate: string;
  endDate: string;
  requirements: CreateChallengeRequirementPayload[];
}

export interface UpdateChallengePayload {
  name?: string;
  description?: string;
  category?: string;
  difficulty?: ChallengeDifficulty;
  points?: number;
  startDate?: string;
  endDate?: string;
  isActive?: boolean;
}
