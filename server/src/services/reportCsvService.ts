import type { FinancialReportData } from '../types/report.js';
import { formatDay, formatMoney, formatPercent } from '../utils/reportFormat.js';

/**
 * A tiny, dependency-free CSV writer. Reports are generated on demand, so
 * there is no CSV library and no stored export — only this renderer over the
 * one FinancialReportData object that also powers JSON and PDF.
 *
 * Safety rules:
 * - cells containing a comma, a quote or a line break are quoted, and quotes
 *   inside a cell are doubled (RFC 4180);
 * - user-controlled *text* (category, asset, liability and goal names) that
 *   begins with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with a
 *   single apostrophe so spreadsheets never evaluate it as a formula;
 * - financial numbers are never routed through the text guard: they are
 *   formatted by `formatMoney()` from digits, `-` and `.` only, so a negative
 *   amount stays a real negative number cell;
 * - output is UTF-8 with a byte-order mark so Excel detects the encoding.
 */

const UTF8_BOM = '\uFEFF';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Neutralises spreadsheet formula injection for user-controlled text. */
export function sanitizeCsvText(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

class CsvBuilder {
  private readonly lines: string[] = [];

  row(...cells: string[]): void {
    this.lines.push(cells.map(escapeCsvCell).join(','));
  }

  /** User-controlled text: formula-guarded, then written as a cell. */
  text(...cells: string[]): void {
    this.row(...cells.map(sanitizeCsvText));
  }

  blank(): void {
    this.lines.push('');
  }

  section(title: string): void {
    this.blank();
    this.row(title);
  }

  build(): string {
    return `${UTF8_BOM}${this.lines.join('\r\n')}\r\n`;
  }
}

export function renderFinancialReportCsv(
  data: FinancialReportData,
  generatedAt: Date = new Date()
): string {
  const csv = new CsvBuilder();
  const { period, overview, assets, liabilities, goals } = data;

  csv.row('WealthHabit Financial Report');
  csv.row('Generated (UTC)', generatedAt.toISOString());
  csv.row('Period start', formatDay(period.dateFrom));
  csv.row('Period end', formatDay(period.dateTo));
  csv.row('Time zone', period.timezone);
  csv.row(
    'Source',
    'Read-only report generated from existing transactions, assets, liabilities, savings goals and wealth snapshots'
  );

  csv.section('Financial Overview');
  csv.row('Metric', 'Value');
  csv.row('Total income', formatMoney(overview.income));
  csv.row('Total expenses', formatMoney(overview.expenses));
  csv.row('Net cash flow', formatMoney(overview.netCashFlow));
  csv.row('Transactions in period', String(overview.transactionCount));
  csv.row('Current total assets', formatMoney(overview.totalAssets));
  csv.row('Current total liabilities', formatMoney(overview.totalLiabilities));
  csv.row('Current net worth', formatMoney(overview.netWorth));
  csv.row('Active savings goals', String(overview.activeGoalCount));
  csv.row('Completed savings goals', String(overview.completedGoalCount));
  csv.row('Total goal target', formatMoney(overview.totalGoalTarget));
  csv.row('Total goal saved', formatMoney(overview.totalGoalSaved));
  csv.row('Goal progress (%)', formatPercent(overview.goalProgressPercent));

  csv.section('Income Categories');
  csv.row('Category', 'Total', 'Share (%)');
  if (data.incomeCategories.length === 0) {
    csv.text('No income in the selected period', '', '');
  } else {
    for (const category of data.incomeCategories) {
      csv.text(category.name, formatMoney(category.total), formatPercent(category.percentage));
    }
  }

  csv.section('Expense Categories');
  csv.row('Category', 'Total', 'Share (%)');
  if (data.expenseCategories.length === 0) {
    csv.text('No expenses in the selected period', '', '');
  } else {
    for (const category of data.expenseCategories) {
      csv.text(category.name, formatMoney(category.total), formatPercent(category.percentage));
    }
  }

  csv.section('Current Asset Position');
  csv.row('Metric', 'Value');
  csv.row('Asset count', String(assets.assetCount));
  csv.row('Total assets', formatMoney(assets.totalAssets));
  csv.blank();
  csv.row('Asset type', 'Total', 'Share (%)');
  if (assets.byType.length === 0) {
    csv.text('No assets recorded', '', '');
  } else {
    for (const group of assets.byType) {
      csv.text(group.type, formatMoney(group.totalValue), formatPercent(group.percentage));
    }
  }
  csv.blank();
  csv.row('Asset', 'Type', 'Current value', 'Share (%)');
  for (const asset of assets.assets) {
    csv.text(
      asset.name,
      asset.type,
      formatMoney(asset.currentValue),
      formatPercent(asset.percentage)
    );
  }

  csv.section('Current Liability Position');
  csv.row('Metric', 'Value');
  csv.row('Liability count', String(liabilities.liabilityCount));
  csv.row('Total liabilities', formatMoney(liabilities.totalLiabilities));
  csv.blank();
  csv.row('Liability type', 'Outstanding balance', 'Share (%)');
  if (liabilities.byType.length === 0) {
    csv.text('No liabilities recorded', '', '');
  } else {
    for (const group of liabilities.byType) {
      csv.text(
        group.type,
        formatMoney(group.totalBalance),
        formatPercent(group.percentage)
      );
    }
  }
  csv.blank();
  csv.row('Liability', 'Type', 'Outstanding balance', 'Share (%)');
  for (const liability of liabilities.liabilities) {
    csv.text(
      liability.name,
      liability.type,
      formatMoney(liability.outstandingBalance),
      formatPercent(liability.percentage)
    );
  }

  csv.section('Net Worth');
  csv.row('Metric', 'Value');
  csv.row('Current net worth', formatMoney(overview.netWorth));
  csv.row('Current total assets', formatMoney(overview.totalAssets));
  csv.row('Current total liabilities', formatMoney(overview.totalLiabilities));
  csv.blank();
  csv.row('Snapshot date', 'Total assets', 'Total liabilities', 'Net worth');
  if (data.netWorthHistory.length === 0) {
    csv.text('No wealth snapshots in the selected period', '', '', '');
  } else {
    for (const point of data.netWorthHistory) {
      csv.row(
        formatDay(point.snapshotDate),
        formatMoney(point.totalAssets),
        formatMoney(point.totalLiabilities),
        formatMoney(point.netWorth)
      );
    }
  }

  csv.section('Savings Goals');
  csv.row('Metric', 'Value');
  csv.row('Active goals', String(goals.activeCount));
  csv.row('Completed goals', String(goals.completedCount));
  csv.row('Total target amount', formatMoney(goals.totalTargetAmount));
  csv.row('Total saved amount', formatMoney(goals.totalSavedAmount));
  csv.row('Overall progress (%)', formatPercent(goals.progressPercent));
  csv.blank();
  csv.row('Goal', 'Status', 'Target', 'Saved', 'Progress (%)', 'Target date');
  if (goals.items.length === 0) {
    csv.text('No savings goals yet', '', '', '', '', '');
  } else {
    for (const goal of goals.items) {
      csv.text(
        goal.name,
        goal.status,
        formatMoney(goal.targetAmount),
        formatMoney(goal.currentAmount),
        formatPercent(goal.progressPercent),
        formatDay(goal.targetDate)
      );
    }
  }

  csv.blank();
  return csv.build();
}
