export type HabitFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface Habit {
  id: string;
  name: string;
  description: string | null;
  frequency: HabitFrequency;
  target: number | null;
  unit: string | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HabitCurrentPeriod {
  completed: boolean;
  period: string;
}

export interface HabitStreak {
  current: number;
  longest: number;
}

export interface HabitProgress {
  habitId: string;
  frequency: HabitFrequency;
  currentPeriod: HabitCurrentPeriod;
  streak: HabitStreak;
  totalCompletions: number;
  eligiblePeriods: number;
  completionRate: number;
  active: boolean;
}

export interface HabitProgressHistoryItem {
  period: string;
  completed: boolean;
}

export interface HabitProgressHistoryParams {
  page?: number;
  pageSize?: number;
}

export interface HabitProgressHistoryResponse {
  items: HabitProgressHistoryItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface HabitWithProgress extends Habit {
  progress?: HabitProgress;
}

export interface HabitListParams {
  page?: number;
  pageSize?: number;
  active?: boolean;
  frequency?: HabitFrequency;
  includeProgress?: boolean;
}

export interface HabitListResponse {
  habits: HabitWithProgress[];
  page: number;
  pageSize: number;
  total: number;
}

export interface HabitResponse {
  habit: Habit;
}

export interface HabitCompletion {
  habitId: string;
  completionDate: string;
  period: string;
  completedAt: string;
}

export interface HabitCompletionListParams {
  page?: number;
  pageSize?: number;
}

export interface HabitCompletionListResponse {
  completions: HabitCompletion[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CompleteHabitResponse {
  completion: HabitCompletion;
  alreadyCompleted: boolean;
}

export interface UncompleteHabitResponse {
  removed: boolean;
}

export interface CreateHabitPayload {
  name: string;
  description?: string | null;
  frequency: HabitFrequency;
  target?: string | null;
  unit?: string | null;
  startDate: string;
  endDate?: string | null;
}

export interface UpdateHabitPayload extends Partial<CreateHabitPayload> {
  isActive?: boolean;
}
