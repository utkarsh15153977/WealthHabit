import type { FinancialReportData } from '../types/report.js';

/**
 * The shared money/date renderers for every report format. JSON serializes the
 * report values directly, while CSV and PDF both go through these helpers, so
 * a total can never appear as `1000.5` in one export and `1000.50` in another.
 *
 * These are pure formatting functions over values that are already rounded to
 * two decimal places by `roundMoney()` — no financial arithmetic happens here.
 */

export function formatMoney(value: number): string {
  return value.toFixed(2);
}

export function formatPercent(value: number): string {
  return value.toFixed(2);
}

export function formatDay(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Deterministic export filename, e.g.
 * `wealthhabit-financial-report-2026-09-27.csv` — derived from the report
 * period so the same request always produces the same name.
 */
export function reportFileName(
  data: FinancialReportData,
  extension: 'csv' | 'pdf'
): string {
  return `wealthhabit-financial-report-${formatDay(data.period.dateTo)}.${extension}`;
}
