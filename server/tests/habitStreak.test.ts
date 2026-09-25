import { describe, it, expect } from 'vitest';
import { startOfUtcDay } from '../src/utils/date.js';
import {
  eligiblePeriodCount,
  habitPeriodAnchor,
  isConsecutiveHabitPeriod,
  nextHabitPeriod,
  previousHabitPeriod,
} from '../src/utils/habitPeriod.js';
import {
  calculateCurrentStreak,
  calculateHabitProgress,
  calculateLongestStreak,
  normalizeCompletionAnchors,
} from '../src/utils/habitStreak.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = startOfUtcDay(new Date());

function day(offset: number): Date {
  return new Date(today.getTime() + offset * MS_PER_DAY);
}

function days(offsets: number[]): Date[] {
  return offsets.map((offset) => day(offset));
}

function thisMonday(): Date {
  return habitPeriodAnchor('WEEKLY', today);
}

function monthAnchor(back: number): Date {
  return new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1)
  );
}

function progress(overrides: {
  frequency: string;
  startDate: Date;
  endDate?: Date | null;
  completionAnchors: Date[];
}) {
  return calculateHabitProgress({
    frequency: overrides.frequency,
    startDate: overrides.startDate,
    endDate: overrides.endDate ?? null,
    today,
    completionAnchors: overrides.completionAnchors,
  });
}

describe('period helpers', () => {
  it('steps one day for DAILY', () => {
    expect(previousHabitPeriod(day(0), 'DAILY').getTime()).toBe(day(-1).getTime());
    expect(nextHabitPeriod(day(0), 'DAILY').getTime()).toBe(day(1).getTime());
  });

  it('steps one ISO week (Monday to Monday) for WEEKLY', () => {
    const monday = thisMonday();
    expect(previousHabitPeriod(monday, 'WEEKLY').getTime()).toBe(
      addDays(monday, -7).getTime()
    );
    expect(nextHabitPeriod(monday, 'WEEKLY').getTime()).toBe(
      addDays(monday, 7).getTime()
    );
    expect(isConsecutiveHabitPeriod(addDays(monday, -7), monday, 'WEEKLY')).toBe(
      true
    );
    expect(isConsecutiveHabitPeriod(addDays(monday, -8), monday, 'WEEKLY')).toBe(
      false
    );
  });

  it('steps one calendar month for MONTHLY', () => {
    const march = new Date(Date.UTC(2026, 2, 1));
    expect(previousHabitPeriod(march, 'MONTHLY').getTime()).toBe(
      new Date(Date.UTC(2026, 1, 1)).getTime()
    );
    expect(nextHabitPeriod(march, 'MONTHLY').getTime()).toBe(
      new Date(Date.UTC(2026, 3, 1)).getTime()
    );
  });

  it('defensively steps one year for YEARLY', () => {
    const jan = new Date(Date.UTC(2026, 0, 1));
    expect(previousHabitPeriod(jan, 'YEARLY').getTime()).toBe(
      new Date(Date.UTC(2025, 0, 1)).getTime()
    );
  });

  it('normalizes duplicates defensively and sorts ascending', () => {
    const unordered = [day(1), day(-1), day(1), day(0)];
    const normalized = normalizeCompletionAnchors('DAILY', unordered);
    expect(normalized.map((anchor) => anchor.getTime())).toEqual([
      day(-1).getTime(),
      day(0).getTime(),
      day(1).getTime(),
    ]);
  });

  it('reinterprets raw dates into the current frequency periods', () => {
    // Two mid-week days collapse into the same ISO week under WEEKLY.
    const wednesday = new Date(Date.UTC(2026, 8, 23)); // 2026-09-23 (Wed)
    const thursday = new Date(Date.UTC(2026, 8, 24)); // 2026-09-24 (Thu)
    const normalized = normalizeCompletionAnchors('WEEKLY', [
      wednesday,
      thursday,
    ]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].getTime()).toBe(new Date(Date.UTC(2026, 8, 21)).getTime());
  });
});

function addDays(date: Date, offset: number): Date {
  return new Date(date.getTime() + offset * MS_PER_DAY);
}

describe('calculateCurrentStreak / calculateLongestStreak (DAILY)', () => {
  it('counts three consecutive completed days as 3/3', () => {
    const anchors = days([-2, -1, 0]);
    expect(calculateCurrentStreak('DAILY', anchors)).toBe(3);
    expect(calculateLongestStreak('DAILY', anchors)).toBe(3);
  });

  it('counts ✓✓✗✓ as current 1, longest 2', () => {
    const anchors = days([-3, -2, 0]); // -1 missed
    expect(calculateCurrentStreak('DAILY', anchors)).toBe(1);
    expect(calculateLongestStreak('DAILY', anchors)).toBe(2);
  });

  it('counts ✗✓✓ as current 2, longest 2', () => {
    const anchors = days([-1, 0]);
    expect(calculateCurrentStreak('DAILY', anchors)).toBe(2);
    expect(calculateLongestStreak('DAILY', anchors)).toBe(2);
  });

  it('counts ✓✗✓✗✓ as current 1, longest 1', () => {
    const anchors = days([-4, -2, 0]);
    expect(calculateCurrentStreak('DAILY', anchors)).toBe(1);
    expect(calculateLongestStreak('DAILY', anchors)).toBe(1);
  });

  it('includes today when the current period is completed', () => {
    const anchors = days([-3, -2, -1, 0]);
    expect(calculateCurrentStreak('DAILY', anchors)).toBe(4);
  });

  it('ends at the most recent completed period when today is pending', () => {
    // Sep 23 ✓, Sep 24 ✓, Sep 25 ✗ (today) => current streak 2, not 0
    const anchors = days([-2, -1]);
    expect(calculateCurrentStreak('DAILY', anchors)).toBe(2);
    expect(calculateLongestStreak('DAILY', anchors)).toBe(2);
  });

  it('restarts after an earlier gap (Sep 21..25 with Sep 23 missed)', () => {
    // -4 ✓, -3 ✓, -2 ✗, -1 ✓, 0 ✗ => current 1 (only -1), longest 2
    const anchors = days([-4, -3, -1]);
    expect(calculateCurrentStreak('DAILY', anchors)).toBe(1);
    expect(calculateLongestStreak('DAILY', anchors)).toBe(2);
  });

  it('returns 0 with no completions', () => {
    expect(calculateCurrentStreak('DAILY', [])).toBe(0);
    expect(calculateLongestStreak('DAILY', [])).toBe(0);
  });

  it('returns 0 for unsorted input ordering assumptions (sorting is internal)', () => {
    const anchors = [day(0), day(-2), day(-1)];
    expect(calculateCurrentStreak('DAILY', anchors)).toBe(3);
    expect(calculateLongestStreak('DAILY', anchors)).toBe(3);
  });
});

describe('weekly and monthly streaks', () => {
  it('counts consecutive Monday anchors as 3/3', () => {
    const monday = thisMonday();
    const anchors = [monday, addDays(monday, -7), addDays(monday, -14)];
    expect(calculateCurrentStreak('WEEKLY', anchors)).toBe(3);
    expect(calculateLongestStreak('WEEKLY', anchors)).toBe(3);
  });

  it('breaks a weekly streak at a missed week (current 1, longest 2)', () => {
    const monday = thisMonday();
    // weeks -3 and -2 completed, week -1 missed, week 0 completed
    const anchors = [
      monday,
      addDays(monday, -14),
      addDays(monday, -21),
    ];
    expect(calculateCurrentStreak('WEEKLY', anchors)).toBe(1);
    expect(calculateLongestStreak('WEEKLY', anchors)).toBe(2);
  });

  it('counts consecutive month anchors as 3/3', () => {
    const anchors = [monthAnchor(0), monthAnchor(1), monthAnchor(2)];
    expect(calculateCurrentStreak('MONTHLY', anchors)).toBe(3);
    expect(calculateLongestStreak('MONTHLY', anchors)).toBe(3);
  });

  it('breaks a monthly streak at a missed month (current 1, longest 2)', () => {
    // months -3 and -2 completed, month -1 missed, month 0 completed
    const anchors = [monthAnchor(0), monthAnchor(2), monthAnchor(3)];
    expect(calculateCurrentStreak('MONTHLY', anchors)).toBe(1);
    expect(calculateLongestStreak('MONTHLY', anchors)).toBe(2);
  });
});

describe('calculateHabitProgress', () => {
  it('returns all-zero stats for a future-start habit', () => {
    const stats = progress({
      frequency: 'DAILY',
      startDate: day(5),
      completionAnchors: [],
    });
    expect(stats).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      totalCompletions: 0,
      eligiblePeriods: 0,
      completionRate: 0,
    });
  });

  it('computes 0/0 completion rate as 0', () => {
    const stats = progress({
      frequency: 'DAILY',
      startDate: day(0),
      completionAnchors: [],
    });
    expect(stats.eligiblePeriods).toBe(1);
    expect(stats.completionRate).toBe(0);
  });

  it('computes 5/10 as 50', () => {
    const stats = progress({
      frequency: 'DAILY',
      startDate: day(-9),
      completionAnchors: days([-9, -8, -7, -6, -5]),
    });
    expect(stats.eligiblePeriods).toBe(10);
    expect(stats.completionRate).toBe(50);
    expect(stats.currentStreak).toBe(5);
    expect(stats.longestStreak).toBe(5);
  });

  it('computes 10/10 as 100', () => {
    const stats = progress({
      frequency: 'DAILY',
      startDate: day(-9),
      completionAnchors: days([-9, -8, -7, -6, -5, -4, -3, -2, -1, 0]),
    });
    expect(stats.eligiblePeriods).toBe(10);
    expect(stats.completionRate).toBe(100);
    expect(stats.currentStreak).toBe(10);
  });

  it('never returns more than 100 when completions outnumber eligible periods', () => {
    const many: Date[] = [];
    for (let offset = -20; offset <= -6; offset += 1) {
      many.push(day(offset)); // 15 rows, only -9..-6 fall in the window
    }
    const stats = progress({
      frequency: 'DAILY',
      startDate: day(-9),
      completionAnchors: many,
    });
    expect(stats.eligiblePeriods).toBe(10);
    expect(stats.totalCompletions).toBe(15);
    expect(stats.completionRate).toBe(100);
    expect(stats.completionRate).toBeLessThanOrEqual(100);
  });

  it('excludes completions before startDate from streaks', () => {
    const stats = progress({
      frequency: 'DAILY',
      startDate: day(-3),
      completionAnchors: days([-10, -2, -1]),
    });
    expect(stats.currentStreak).toBe(2);
    expect(stats.longestStreak).toBe(2);
    expect(stats.totalCompletions).toBe(3);
    expect(stats.eligiblePeriods).toBe(4);
    expect(stats.completionRate).toBe(75);
  });

  it('keeps historical streaks for an expired habit without future periods', () => {
    const stats = progress({
      frequency: 'DAILY',
      startDate: day(-10),
      endDate: day(-5),
      completionAnchors: days([-10, -9, -8, -1]),
    });
    // -1 falls after the endDate: excluded from streaks but still counted.
    expect(stats.currentStreak).toBe(3);
    expect(stats.longestStreak).toBe(3);
    expect(stats.eligiblePeriods).toBe(6);
    expect(stats.totalCompletions).toBe(4);
    expect(stats.completionRate).toBe(66.67);
  });

  it('treats duplicate anchors as a single period for streaks', () => {
    const stats = progress({
      frequency: 'DAILY',
      startDate: day(-1),
      completionAnchors: [day(0), day(0)],
    });
    expect(stats.currentStreak).toBe(1);
    expect(stats.longestStreak).toBe(1);
  });

  it('matches eligiblePeriodCount for monthly habits', () => {
    const start = monthAnchor(3);
    const expected = eligiblePeriodCount('MONTHLY', start, null, today);
    const stats = progress({
      frequency: 'MONTHLY',
      startDate: start,
      completionAnchors: [monthAnchor(0), monthAnchor(1)],
    });
    expect(stats.eligiblePeriods).toBe(expected);
    expect(stats.currentStreak).toBe(2);
  });
});
