import { HabitFrequency } from '../utils/habitPeriod.js';

export type ChallengeTypeData = 'HABIT_COMPLETION';

export type ChallengeDifficultyData = 'EASY' | 'MEDIUM' | 'HARD';

/**
 * Derived challenge status (never persisted):
 * - UPCOMING: today < startDate
 * - ACTIVE:   startDate <= today <= endDate and isActive
 * - ENDED:    today > endDate (or explicitly deactivated)
 */
export type ChallengeStatusData = 'UPCOMING' | 'ACTIVE' | 'ENDED';

/** Derived participant status (never persisted). */
export type ChallengeParticipantStatusData = 'NOT_JOINED' | 'JOINED' | 'COMPLETED';

export interface ChallengeRequirementData {
  id: string;
  challengeId: string;
  name: string;
  description: string | null;
  frequency: HabitFrequency;
  target: number;
  unit: string | null;
  createdAt: Date;
}

export interface ChallengeRequirementProgressData {
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

export interface ChallengeProgressData {
  challengeId: string;
  joined: true;
  status: 'JOINED' | 'COMPLETED';
  startDate: Date;
  endDate: Date;
  completedPeriods: number;
  eligiblePeriods: number;
  completionRate: number;
  completed: boolean;
  requirements: ChallengeRequirementProgressData[];
}

export interface ChallengeParticipationData {
  joined: boolean;
  joinedAt: Date | null;
  status: ChallengeParticipantStatusData;
  progress: ChallengeProgressData | null;
}

export interface ChallengeData {
  id: string;
  name: string;
  description: string;
  type: ChallengeTypeData;
  category: string;
  difficulty: ChallengeDifficultyData;
  points: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  status: ChallengeStatusData;
  createdAt: Date;
  updatedAt: Date;
  requirements: ChallengeRequirementData[];
  participation: ChallengeParticipationData;
}

export interface ChallengeListData {
  challenges: ChallengeData[];
  page: number;
  pageSize: number;
  total: number;
  activeCount: number;
  joinedCount: number;
}

export interface ChallengeResponse {
  challenge: ChallengeData;
}

export interface JoinChallengeData {
  challengeId: string;
  joined: true;
  alreadyJoined: boolean;
}

export interface LeaveChallengeData {
  challengeId: string;
  left: true;
  wasJoined: boolean;
}

export interface MapChallengeHabitData {
  mapping: {
    requirementId: string;
    habitId: string;
  };
}

export interface ChallengeDeleteData {
  message: string;
}
