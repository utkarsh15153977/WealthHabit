import { HabitFrequency } from '../utils/habitPeriod.js';

export interface HabitData {
  id: string;
  name: string;
  description: string | null;
  frequency: HabitFrequency;
  target: number | null;
  unit: string | null;
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface HabitCurrentPeriod {
  completed: boolean;
  period: string;
}

export interface HabitProgressData {
  habitId: string;
  currentPeriod: HabitCurrentPeriod;
  totalCompletions: number;
  completionRate: number;
  active: boolean;
}

export interface HabitListItem extends HabitData {
  progress?: HabitProgressData;
}

export interface HabitListData {
  habits: HabitListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface HabitResponse {
  habit: HabitData;
}

export interface HabitCompletionData {
  habitId: string;
  completionDate: Date;
  period: string;
  completedAt: Date;
}

export interface HabitCompletionListData {
  completions: HabitCompletionData[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CompleteHabitData {
  completion: HabitCompletionData;
  alreadyCompleted: boolean;
}

export interface UncompleteHabitData {
  removed: boolean;
}
