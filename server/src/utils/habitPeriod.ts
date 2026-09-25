import { Frequency } from '@prisma/client';
import { addUtcDays, startOfUtcDay } from './date.js';

export type HabitFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export const HABIT_FREQUENCIES: readonly HabitFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * Returns the UTC-midnight anchor of the occurrence period containing `date`:
 * - DAILY:  the UTC calendar day itself            (2026-09-25)
 * - WEEKLY: the Monday of the ISO-8601 week        (2026-09-21)
 * - MONTHLY: the first day of the UTC month        (2026-09-01)
 * - YEARLY: the first day of the UTC year          (defensive; not exposed by the API)
 *
 * The anchor stored in `HabitCompletion.completionDate` is what gives the
 * existing @@unique([habitId, completionDate]) constraint per-period
 * idempotency for every frequency.
 */
export function habitPeriodAnchor(frequency: Frequency | string, date: Date): Date {
  const day = startOfUtcDay(date);

  switch (frequency) {
    case 'WEEKLY': {
      const dayOfWeek = day.getUTCDay();
      const daysSinceMonday = (dayOfWeek + 6) % 7;
      return addUtcDays(day, -daysSinceMonday);
    }
    case 'MONTHLY':
      return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
    case 'YEARLY':
      return new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    case 'DAILY':
    default:
      return day;
  }
}

/**
 * Human/machine-readable period key:
 * - DAILY / WEEKLY: 'YYYY-MM-DD' (for WEEKLY, the Monday of the ISO week)
 * - MONTHLY: 'YYYY-MM'
 * - YEARLY: 'YYYY'
 */
export function habitPeriodKey(frequency: Frequency | string, date: Date): string {
  const anchor = habitPeriodAnchor(frequency, date);

  if (frequency === 'MONTHLY') {
    return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (frequency === 'YEARLY') {
    return String(anchor.getUTCFullYear());
  }
  return anchor.toISOString().slice(0, 10);
}

/**
 * A habit occurrence is completable when the UTC day is within
 * [startDate, endDate] inclusive. Both bounds are UTC calendar days.
 */
export function isHabitActiveOn(
  habit: { startDate: Date; endDate: Date | null },
  date: Date
): boolean {
  const day = startOfUtcDay(date).getTime();
  if (day < startOfUtcDay(habit.startDate).getTime()) {
    return false;
  }
  if (habit.endDate !== null && day > startOfUtcDay(habit.endDate).getTime()) {
    return false;
  }
  return true;
}

/**
 * Inclusive anchor bounds of the eligible occurrence window:
 * [anchor(startDate), anchor(min(endDate, today))], or null when the
 * window is empty (e.g. a habit whose startDate is in the future).
 * Single source of truth shared by the count, streak and history logic.
 */
export function eligiblePeriodBounds(
  frequency: Frequency | string,
  startDate: Date,
  endDate: Date | null,
  today: Date
): { from: Date; to: Date } | null {
  const from = habitPeriodAnchor(frequency, startDate);
  const todayDay = startOfUtcDay(today);
  const lastDay =
    endDate !== null && startOfUtcDay(endDate) < todayDay ? endDate : today;
  const to = habitPeriodAnchor(frequency, lastDay);

  if (to.getTime() < from.getTime()) {
    return null;
  }
  return { from, to };
}

/**
 * Number of eligible occurrence periods between `startDate` and
 * min(`endDate`, `today`) inclusive, in UTC calendar terms. Computed
 * arithmetically (no per-period iteration).
 */
export function eligiblePeriodCount(
  frequency: Frequency | string,
  startDate: Date,
  endDate: Date | null,
  today: Date
): number {
  const bounds = eligiblePeriodBounds(frequency, startDate, endDate, today);
  if (bounds === null) {
    return 0;
  }
  const { from, to } = bounds;

  switch (frequency) {
    case 'WEEKLY':
      return Math.floor((to.getTime() - from.getTime()) / MS_PER_WEEK) + 1;
    case 'MONTHLY': {
      const months =
        (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
        (to.getUTCMonth() - from.getUTCMonth());
      return months + 1;
    }
    case 'YEARLY':
      return to.getUTCFullYear() - from.getUTCFullYear() + 1;
    case 'DAILY':
    default:
      return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;
  }
}

/**
 * UTC anchor of the occurrence immediately before `anchor`.
 * All arithmetic is UTC calendar math (no local timezone involvement).
 */
export function previousHabitPeriod(
  anchor: Date,
  frequency: Frequency | string
): Date {
  const current = habitPeriodAnchor(frequency, anchor);

  switch (frequency) {
    case 'WEEKLY':
      return addUtcDays(current, -7);
    case 'MONTHLY':
      return new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)
      );
    case 'YEARLY':
      return new Date(Date.UTC(current.getUTCFullYear() - 1, 0, 1));
    case 'DAILY':
    default:
      return addUtcDays(current, -1);
  }
}

/**
 * UTC anchor of the occurrence immediately after `anchor`.
 */
export function nextHabitPeriod(
  anchor: Date,
  frequency: Frequency | string
): Date {
  const current = habitPeriodAnchor(frequency, anchor);

  switch (frequency) {
    case 'WEEKLY':
      return addUtcDays(current, 7);
    case 'MONTHLY':
      return new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)
      );
    case 'YEARLY':
      return new Date(Date.UTC(current.getUTCFullYear() + 1, 0, 1));
    case 'DAILY':
    default:
      return addUtcDays(current, 1);
  }
}

/**
 * True when `previous` is the occurrence immediately before `current`
 * under the habit's period semantics (UTC).
 */
export function isConsecutiveHabitPeriod(
  previous: Date,
  current: Date,
  frequency: Frequency | string
): boolean {
  const expected = previousHabitPeriod(current, frequency);
  const actual = habitPeriodAnchor(frequency, previous);
  return expected.getTime() === actual.getTime();
}
