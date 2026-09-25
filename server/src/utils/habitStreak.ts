import { Frequency } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { roundRate } from './money.js';
import {
  eligiblePeriodBounds,
  eligiblePeriodCount,
  habitPeriodAnchor,
  habitPeriodKey,
  isConsecutiveHabitPeriod,
} from './habitPeriod.js';

/**
 * Habit streaks are DERIVED DATA: HabitCompletion rows are the only source
 * of truth. Nothing here talks to the database — every function is pure and
 * recomputed on demand, so no currentStreak/longestStreak value is ever
 * persisted and no synchronization problems can arise.
 *
 * All math is UTC. Completions are normalized to the habit's current
 * frequency period anchors before counting (a frequency change reinterprets
 * historical rows; rows themselves are never rewritten).
 */
export interface HabitProgressStats {
  currentStreak: number;
  longestStreak: number;
  totalCompletions: number;
  eligiblePeriods: number;
  completionRate: number;
}

/**
 * Normalizes raw completion dates to period anchors of the current
 * frequency, removes duplicates defensively (the DB unique constraint
 * already prevents them) and sorts ascending chronologically.
 */
export function normalizeCompletionAnchors(
  frequency: Frequency | string,
  completionAnchors: Date[]
): Date[] {
  const seen = new Set<string>();
  const normalized: Date[] = [];

  for (const raw of completionAnchors) {
    const anchor = habitPeriodAnchor(frequency, raw);
    const key = habitPeriodKey(frequency, anchor);
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(anchor);
    }
  }

  normalized.sort((a, b) => a.getTime() - b.getTime());
  return normalized;
}

function currentStreakFromSorted(frequency: Frequency | string, sorted: Date[]): number {
  if (sorted.length === 0) {
    return 0;
  }
  let streak = 1;
  for (let i = sorted.length - 1; i > 0; i -= 1) {
    if (!isConsecutiveHabitPeriod(sorted[i - 1], sorted[i], frequency)) {
      break;
    }
    streak += 1;
  }
  return streak;
}

function longestStreakFromSorted(frequency: Frequency | string, sorted: Date[]): number {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && isConsecutiveHabitPeriod(sorted[i - 1], sorted[i], frequency)) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longest) {
      longest = run;
    }
  }
  return longest;
}

/**
 * Current streak: consecutive completed periods ending at the most recent
 * completed period. A not-yet-completed current period does NOT reset the
 * streak to 0 — the streak ends at the latest completed occurrence
 * (Sep 23 ✓, Sep 24 ✓, Sep 25 ✗ (today) => current streak 2). An earlier
 * gap does break it (Sep 23 ✗ => the run after it starts fresh).
 *
 * Only completions inside the eligible window [startDate, min(endDate,
 * today)] count; a future-start habit or an out-of-window completion never
 * contributes.
 */
export function calculateCurrentStreak(
  frequency: Frequency | string,
  completionAnchors: Date[]
): number {
  return currentStreakFromSorted(
    frequency,
    normalizeCompletionAnchors(frequency, completionAnchors)
  );
}

/**
 * Longest streak: the longest run of consecutive eligible completed
 * periods anywhere in the history. O(n) after the defensive sort.
 */
export function calculateLongestStreak(
  frequency: Frequency | string,
  completionAnchors: Date[]
): number {
  return longestStreakFromSorted(
    frequency,
    normalizeCompletionAnchors(frequency, completionAnchors)
  );
}

/**
 * completionRate = completed eligible periods / eligible periods × 100,
 * Decimal-rounded to 2 places, never above 100 and never negative
 * (Phase 4A definition preserved, including the defensive cap when
 * completions exist before the current startDate).
 */
function completionRate(
  frequency: Frequency | string,
  startDate: Date,
  endDate: Date | null,
  totalCompletions: number,
  today: Date
): number {
  const eligible = eligiblePeriodCount(frequency, startDate, endDate, today);
  if (eligible <= 0) {
    return 0;
  }
  const completed = Math.min(totalCompletions, eligible);
  return roundRate(
    new Prisma.Decimal(completed).dividedBy(eligible).mul(100)
  );
}

/**
 * Full derived progress for one habit, computed on demand:
 * current streak, longest streak, completion totals and rate.
 *
 * - totalCompletions: every completion row (raw count, Phase 4A semantics)
 * - streaks: only completions inside the eligible window, normalized to the
 *   habit's current frequency
 * - eligible periods: unchanged arithmetic window of Phase 4A; deactivation
 *   does not alter it (paused habits keep their historical statistics and
 *   simply stop accepting new completions)
 */
export function calculateHabitProgress(input: {
  frequency: Frequency | string;
  startDate: Date;
  endDate: Date | null;
  today: Date;
  completionAnchors: Date[];
}): HabitProgressStats {
  const { frequency, startDate, endDate, today, completionAnchors } = input;

  const eligiblePeriods = eligiblePeriodCount(frequency, startDate, endDate, today);
  const bounds = eligiblePeriodBounds(frequency, startDate, endDate, today);
  const normalized = normalizeCompletionAnchors(frequency, completionAnchors);
  const inRange =
    bounds === null
      ? []
      : normalized.filter(
          (anchor) =>
            anchor.getTime() >= bounds.from.getTime() &&
            anchor.getTime() <= bounds.to.getTime()
        );

  return {
    currentStreak: currentStreakFromSorted(frequency, inRange),
    longestStreak: longestStreakFromSorted(frequency, inRange),
    totalCompletions: completionAnchors.length,
    eligiblePeriods,
    completionRate: completionRate(
      frequency,
      startDate,
      endDate,
      completionAnchors.length,
      today
    ),
  };
}
