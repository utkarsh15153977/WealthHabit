import { Frequency } from '@prisma/client';
import { addUtcDays, startOfUtcDay } from './date.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Returns the occurrence strictly after `current` using `anchorDay`/anchor month
 * from the original startDate. MONTHLY and YEARLY clamp the day to the last
 * valid day of the target month; the clamp never persists because every step is
 * computed against the anchor, not against the clamped value.
 */
export function nextOccurrenceAfter(
  current: Date,
  anchorDay: number,
  anchorMonthIndex: number,
  frequency: Frequency
): Date {
  switch (frequency) {
    case 'DAILY':
      return addUtcDays(current, 1);
    case 'WEEKLY':
      return addUtcDays(current, 7);
    case 'MONTHLY': {
      const year = current.getUTCFullYear();
      const month = current.getUTCMonth();
      const targetYear = month === 11 ? year + 1 : year;
      const targetMonth = month === 11 ? 0 : month + 1;
      const day = Math.min(anchorDay, daysInUtcMonth(targetYear, targetMonth));
      return new Date(Date.UTC(targetYear, targetMonth, day));
    }
    case 'YEARLY': {
      const targetYear = current.getUTCFullYear() + 1;
      const day = Math.min(anchorDay, daysInUtcMonth(targetYear, anchorMonthIndex));
      return new Date(Date.UTC(targetYear, anchorMonthIndex, day));
    }
    default: {
      const exhaustive: never = frequency;
      throw new Error(`Unsupported frequency: ${String(exhaustive)}`);
    }
  }
}

/**
 * Collects every occurrence from `cursor` (inclusive) through `horizon`
 * (inclusive), never passing `endDate` (inclusive). Both bounds are compared as
 * UTC calendar days.
 */
export function collectDueOccurrences(
  cursor: Date,
  horizon: Date,
  endDate: Date | null,
  frequency: Frequency,
  anchorDay: number,
  anchorMonthIndex: number
): Date[] {
  const dates: Date[] = [];
  let current = cursor;

  const horizonTime = horizon.getTime();
  const endTime = endDate ? endDate.getTime() : null;

  while (current.getTime() <= horizonTime) {
    if (endTime !== null && current.getTime() > endTime) {
      break;
    }
    dates.push(current);
    const next = nextOccurrenceAfter(current, anchorDay, anchorMonthIndex, frequency);
    if (next.getTime() <= current.getTime()) {
      throw new Error('Recurrence step did not advance; refusing to loop');
    }
    current = next;
  }

  return dates;
}

function clampToMonths(anchor: Date, months: number): Date {
  const totalMonths = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  const day = Math.min(anchor.getUTCDate(), daysInUtcMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

function clampToYears(anchor: Date, years: number): Date {
  const year = anchor.getUTCFullYear() + years;
  const month = anchor.getUTCMonth();
  const day = Math.min(anchor.getUTCDate(), daysInUtcMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

/**
 * Returns the next obligation date strictly after `current` on the schedule
 * anchored at `anchor` (e.g. a bill's original due date, a subscription's
 * creation day). Clamping (Jan 31 → Feb 28) never drifts the anchor: the next
 * step re-derives from `anchor`, so Feb 28 → Mar 31. This advances the
 * obligation only; it never creates transactions.
 */
export function advanceObligation(
  anchor: Date,
  current: Date,
  frequency: Frequency
): Date {
  const a = startOfUtcDay(anchor);
  const c = startOfUtcDay(current);

  if (c.getTime() < a.getTime()) {
    return a;
  }

  const diffDays = Math.floor((c.getTime() - a.getTime()) / MS_PER_DAY);

  switch (frequency) {
    case 'DAILY':
      return addUtcDays(a, diffDays + 1);
    case 'WEEKLY':
      return addUtcDays(a, (Math.floor(diffDays / 7) + 1) * 7);
    case 'MONTHLY': {
      const monthDiff =
        (c.getUTCFullYear() - a.getUTCFullYear()) * 12 + (c.getUTCMonth() - a.getUTCMonth());
      let candidate = clampToMonths(a, monthDiff);
      if (candidate.getTime() <= c.getTime()) {
        candidate = clampToMonths(a, monthDiff + 1);
      }
      return candidate;
    }
    case 'YEARLY': {
      const yearDiff = c.getUTCFullYear() - a.getUTCFullYear();
      let candidate = clampToYears(a, yearDiff);
      if (candidate.getTime() <= c.getTime()) {
        candidate = clampToYears(a, yearDiff + 1);
      }
      return candidate;
    }
    default: {
      const exhaustive: never = frequency;
      throw new Error(`Unsupported frequency: ${String(exhaustive)}`);
    }
  }
}
