import { Frequency } from '@prisma/client';
import { addUtcDays } from './date.js';

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
