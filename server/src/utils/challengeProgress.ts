import { Prisma } from '@prisma/client';
import { roundRate } from './money.js';
import { eligiblePeriodCount, habitPeriodKey } from './habitPeriod.js';
import { startOfUtcDay } from './date.js';
import type {
  ChallengeProgressData,
  ChallengeRequirementData,
  ChallengeRequirementProgressData,
} from '../types/challenge.js';

/**
 * Challenge progress is DERIVED DATA: HabitCompletion rows are the only
 * source of truth. Challenges never create completions, transactions or
 * financial records — this module is pure and never touches the database.
 *
 * A requirement's eligibility is the day-level intersection of:
 *   [challenge.startDate, min(challenge.endDate, today)]  (UTC calendar days)
 *   ∩
 *   [habit.startDate, habit.endDate]                      (participant's habit)
 *
 * Completions outside that intersection never count; a period counts as
 * completed when the requirement's `target` completions (default 1) fall in
 * it. All percentages use Decimal math rounded to 2 places, capped at 100.
 */

export interface ChallengeWindowInput {
  startDate: Date;
  endDate: Date;
}

export interface ChallengeHabitInput {
  id: string;
  startDate: Date;
  endDate: Date | null;
}

/**
 * Day-level eligibility window of one requirement for one participant:
 * challenge window (capped at today) intersected with the mapped habit's
 * own eligibility window. Returns null when the intersection is empty.
 */
function requirementDayWindow(
  challenge: ChallengeWindowInput,
  habit: ChallengeHabitInput | null,
  today: Date
): { from: Date; to: Date } | null {
  const todayDay = startOfUtcDay(today);
  let from = startOfUtcDay(challenge.startDate);
  let to =
    startOfUtcDay(challenge.endDate).getTime() < todayDay.getTime()
      ? startOfUtcDay(challenge.endDate)
      : todayDay;

  if (habit !== null) {
    const habitFrom = startOfUtcDay(habit.startDate);
    if (habitFrom.getTime() > from.getTime()) {
      from = habitFrom;
    }
    if (habit.endDate !== null) {
      const habitTo = startOfUtcDay(habit.endDate);
      if (habitTo.getTime() < to.getTime()) {
        to = habitTo;
      }
    }
  }

  if (from.getTime() > to.getTime()) {
    return null;
  }
  return { from, to };
}

function completionRate(completed: number, eligible: number): number {
  if (eligible <= 0) {
    return 0;
  }
  return roundRate(
    new Prisma.Decimal(Math.min(completed, eligible)).dividedBy(eligible).mul(100)
  );
}

export function calculateRequirementProgress(input: {
  challenge: ChallengeWindowInput;
  requirement: ChallengeRequirementData;
  habit: ChallengeHabitInput | null;
  completionAnchors: Date[];
  today: Date;
}): ChallengeRequirementProgressData {
  const { challenge, requirement, habit, completionAnchors, today } = input;
  const window = requirementDayWindow(challenge, habit, today);

  const eligiblePeriods =
    window === null
      ? 0
      : eligiblePeriodCount(requirement.frequency, window.from, window.to, today);

  if (habit === null || window === null || eligiblePeriods <= 0) {
    return {
      requirementId: requirement.id,
      name: requirement.name,
      frequency: requirement.frequency,
      target: requirement.target,
      unit: requirement.unit,
      mapped: habit !== null,
      habitId: habit?.id ?? null,
      completedPeriods: 0,
      eligiblePeriods,
      completionRate: completionRate(0, eligiblePeriods),
    };
  }

  const counts = new Map<string, number>();
  for (const anchor of completionAnchors) {
    const day = startOfUtcDay(anchor).getTime();
    if (day < window.from.getTime() || day > window.to.getTime()) {
      continue;
    }
    const key = habitPeriodKey(requirement.frequency, anchor);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let completedPeriods = 0;
  for (const count of counts.values()) {
    if (count >= requirement.target) {
      completedPeriods += 1;
    }
  }
  if (completedPeriods > eligiblePeriods) {
    completedPeriods = eligiblePeriods;
  }

  return {
    requirementId: requirement.id,
    name: requirement.name,
    frequency: requirement.frequency,
    target: requirement.target,
    unit: requirement.unit,
    mapped: true,
    habitId: habit.id,
    completedPeriods,
    eligiblePeriods,
    completionRate: completionRate(completedPeriods, eligiblePeriods),
  };
}

/**
 * Full derived progress for one participant of one challenge:
 * completed eligible periods / total eligible periods × 100, summed across
 * the challenge's requirements. `completed` (and the participant status)
 * is derived as progress reaching 100 — never persisted.
 */
export function calculateChallengeProgress(input: {
  challenge: { id: string; startDate: Date; endDate: Date };
  requirements: ChallengeRequirementData[];
  habitsByRequirement: Map<string, ChallengeHabitInput | null>;
  completionsByHabit: Map<string, Date[]>;
  today: Date;
}): ChallengeProgressData {
  const { challenge, requirements, habitsByRequirement, completionsByHabit, today } =
    input;

  const requirementProgress = requirements.map((requirement) => {
    const habit = habitsByRequirement.get(requirement.id) ?? null;
    return calculateRequirementProgress({
      challenge,
      requirement,
      habit,
      completionAnchors: habit !== null ? (completionsByHabit.get(habit.id) ?? []) : [],
      today,
    });
  });

  let completedPeriods = 0;
  let eligiblePeriods = 0;
  for (const progress of requirementProgress) {
    completedPeriods += progress.completedPeriods;
    eligiblePeriods += progress.eligiblePeriods;
  }

  const completed = eligiblePeriods > 0 && completedPeriods >= eligiblePeriods;

  return {
    challengeId: challenge.id,
    joined: true,
    status: completed ? 'COMPLETED' : 'JOINED',
    startDate: challenge.startDate,
    endDate: challenge.endDate,
    completedPeriods,
    eligiblePeriods,
    completionRate: completionRate(completedPeriods, eligiblePeriods),
    completed,
    requirements: requirementProgress,
  };
}
