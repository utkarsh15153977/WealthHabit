const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addUtcDays(value: Date, days: number): Date {
  return new Date(startOfUtcDay(value).getTime() + days * MS_PER_DAY);
}

export function toUtcMonthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

export function currentUtcMonth(): string {
  const now = new Date();
  return toUtcMonthKey(now.getUTCFullYear(), now.getUTCMonth());
}

export function parseMonthKey(month: string): { year: number; monthIndex: number } {
  const [year, monthNum] = month.split('-').map(Number);
  return { year, monthIndex: monthNum - 1 };
}

export function monthBounds(month: string): { start: Date; end: Date } {
  const { year, monthIndex } = parseMonthKey(month);
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}