import PDFDocument from 'pdfkit';
import type { FinancialReportData } from '../types/report.js';
import { formatDay, formatMoney, formatPercent } from '../utils/reportFormat.js';

/**
 * Server-side PDF rendering of the exact FinancialReportData object that
 * powers the JSON preview and the CSV export. Nothing is recalculated here -
 * every value is formatted straight from the shared report object, so the
 * three formats can never disagree.
 *
 * pdfkit is used because it is a lightweight, deterministic, server-side
 * renderer with no browser/Chromium process: text and tables are drawn as
 * real PDF content, page breaks are handled explicitly, and long lists simply
 * continue on the next page. Generated buffers are streamed to the client and
 * never stored.
 */

const MARGIN = 48;
const FOOTER_HEIGHT = 26;
const ROW_PADDING = 4;

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';
const HEAD_BG = '#f3f4f6';

type PdfDoc = InstanceType<typeof PDFDocument>;

interface CellStyle {
  font: 'Helvetica' | 'Helvetica-Bold';
  size: number;
  color: string;
  align: 'left' | 'right';
}

const BODY_STYLE: CellStyle = {
  font: 'Helvetica',
  size: 9,
  color: INK,
  align: 'left',
};

const HEAD_STYLE: CellStyle = {
  font: 'Helvetica-Bold',
  size: 9,
  color: MUTED,
  align: 'left',
};

const VALUE_STYLE: CellStyle = { ...BODY_STYLE, align: 'right' };
const HEAD_VALUE_STYLE: CellStyle = { ...HEAD_STYLE, align: 'right' };

/** Standard-14 fonts are Latin-1 only; map everything else to a placeholder. */
function pdfText(value: string): string {
  return value.replace(/[^\t\n\r\x20-\x7e\xa0-\xff]/g, '?');
}

export async function renderFinancialReportPdf(
  data: FinancialReportData,
  generatedAt: Date = new Date()
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    // Uncompressed content streams: the report is plain text and tables, so
    // skipping compression keeps the file simple and its contents verifiable.
    compress: false,
    info: {
      Title: 'WealthHabit Financial Report',
      Author: 'WealthHabit',
      Subject: `Financial report ${formatDay(data.period.dateFrom)} to ${formatDay(
        data.period.dateTo
      )}`,
      CreationDate: generatedAt,
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });

  drawReport(doc, data, generatedAt);

  doc.end();
  await finished;

  return Buffer.concat(chunks);
}

function contentWidth(doc: PdfDoc): number {
  return doc.page.width - MARGIN * 2;
}

function bottomLimit(doc: PdfDoc): number {
  return doc.page.height - MARGIN - FOOTER_HEIGHT;
}

function ensureSpace(doc: PdfDoc, height: number): void {
  if (doc.y + height > bottomLimit(doc)) {
    doc.addPage();
  }
}

function gap(doc: PdfDoc, points = 8): void {
  doc.y += points;
}

function sectionTitle(doc: PdfDoc, title: string): void {
  // Reserve enough room for the heading plus the first row so a section title
  // is never left alone at the bottom of a page.
  ensureSpace(doc, 72);
  gap(doc, 14);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK);
  doc.text(pdfText(title), MARGIN, doc.y, { width: contentWidth(doc) });
  const ruleY = doc.y + 3;
  doc
    .strokeColor(RULE)
    .lineWidth(1)
    .moveTo(MARGIN, ruleY)
    .lineTo(MARGIN + contentWidth(doc), ruleY)
    .stroke();
  doc.y = ruleY + 8;
}

function note(doc: PdfDoc, message: string): void {
  ensureSpace(doc, 16);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  doc.text(pdfText(message), MARGIN, doc.y, { width: contentWidth(doc) });
  doc.y += 2;
}

function rowHeight(doc: PdfDoc, cells: string[], widths: number[]): number {
  let max = 0;
  cells.forEach((cell, index) => {
    const height = doc.heightOfString(pdfText(cell), {
      width: widths[index] - 8,
      lineGap: 1,
    });
    if (height > max) max = height;
  });
  return max + ROW_PADDING * 2;
}

function drawRow(
  doc: PdfDoc,
  cells: string[],
  widths: number[],
  styles: CellStyle[],
  options: { background?: string; rule?: boolean } = {}
): void {
  const primary = styles[0] ?? BODY_STYLE;
  doc.font(primary.font).fontSize(primary.size);
  const height = rowHeight(doc, cells, widths);
  ensureSpace(doc, height + 2);

  const top = doc.y;

  if (options.background) {
    doc.save();
    doc.rect(MARGIN, top, contentWidth(doc), height).fill(options.background);
    doc.restore();
  }

  let x = MARGIN;
  cells.forEach((cell, index) => {
    const style = styles[index] ?? BODY_STYLE;
    doc.font(style.font).fontSize(style.size).fillColor(style.color);
    doc.text(pdfText(cell), x + 4, top + ROW_PADDING, {
      width: widths[index] - 8,
      lineGap: 1,
      align: style.align,
    });
    x += widths[index];
  });

  doc.y = top + height;

  if (options.rule) {
    doc
      .strokeColor(RULE)
      .lineWidth(0.5)
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + contentWidth(doc), doc.y)
      .stroke();
    doc.y += 1;
  }
}

function table(
  doc: PdfDoc,
  headers: string[],
  rows: string[][],
  fractions: number[],
  valueColumns: number[]
): void {
  const width = contentWidth(doc);
  const widths = fractions.map((fraction) => width * fraction);

  const headStyles = headers.map((_, index) =>
    valueColumns.includes(index) ? HEAD_VALUE_STYLE : HEAD_STYLE
  );
  const bodyStyles = headers.map((_, index) =>
    valueColumns.includes(index) ? VALUE_STYLE : BODY_STYLE
  );

  drawRow(doc, headers, widths, headStyles, { background: HEAD_BG, rule: true });

  for (const row of rows) {
    drawRow(doc, row, widths, bodyStyles, { rule: true });
  }
}

function keyValues(doc: PdfDoc, rows: [string, string][]): void {
  const width = contentWidth(doc);
  const widths = [width * 0.6, width * 0.4];
  for (const [label, value] of rows) {
    drawRow(doc, [label, value], widths, [
      BODY_STYLE,
      { ...VALUE_STYLE, font: 'Helvetica-Bold' },
    ]);
  }
}

function drawReport(doc: PdfDoc, data: FinancialReportData, generatedAt: Date): void {
  const { period, overview, assets, liabilities, goals } = data;
  const width = contentWidth(doc);

  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK);
  doc.text('WealthHabit', MARGIN, doc.y, { width });
  doc.y += 4;
  doc.font('Helvetica').fontSize(14).fillColor(MUTED);
  doc.text('Financial Report', MARGIN, doc.y, { width });
  doc.y += 12;

  keyValues(doc, [
    ['Report period', `${formatDay(period.dateFrom)} to ${formatDay(period.dateTo)}`],
    ['Time zone', period.timezone],
    ['Generated (UTC)', generatedAt.toISOString()],
  ]);

  note(
    doc,
    'Read-only report generated from existing WealthHabit records. Figures are descriptive and are not financial advice.'
  );

  sectionTitle(doc, 'Financial Overview');
  table(
    doc,
    ['Metric', 'Value'],
    [
      ['Total income', formatMoney(overview.income)],
      ['Total expenses', formatMoney(overview.expenses)],
      ['Net cash flow', formatMoney(overview.netCashFlow)],
      ['Transactions in period', String(overview.transactionCount)],
      ['Current total assets', formatMoney(overview.totalAssets)],
      ['Current total liabilities', formatMoney(overview.totalLiabilities)],
      ['Current net worth', formatMoney(overview.netWorth)],
      ['Active savings goals', String(overview.activeGoalCount)],
      ['Completed savings goals', String(overview.completedGoalCount)],
      ['Total goal target', formatMoney(overview.totalGoalTarget)],
      ['Total goal saved', formatMoney(overview.totalGoalSaved)],
      ['Goal progress (%)', formatPercent(overview.goalProgressPercent)],
    ],
    [0.6, 0.4],
    [1]
  );

  sectionTitle(doc, 'Income & Expenses');
  table(
    doc,
    ['Metric', 'Value'],
    [
      ['Total income', formatMoney(overview.income)],
      ['Total expenses', formatMoney(overview.expenses)],
      ['Net cash flow', formatMoney(overview.netCashFlow)],
      ['Transactions in period', String(overview.transactionCount)],
    ],
    [0.6, 0.4],
    [1]
  );
  note(
    doc,
    'Cash flow describes transaction activity in the selected period. It is not a change in net worth.'
  );

  sectionTitle(doc, 'Income Categories');
  if (data.incomeCategories.length === 0) {
    note(doc, 'No income in the selected period.');
  } else {
    table(
      doc,
      ['Category', 'Total', 'Share (%)'],
      data.incomeCategories.map((category) => [
        category.name,
        formatMoney(category.total),
        formatPercent(category.percentage),
      ]),
      [0.6, 0.2, 0.2],
      [1, 2]
    );
  }

  sectionTitle(doc, 'Expense Categories');
  if (data.expenseCategories.length === 0) {
    note(doc, 'No expenses in the selected period.');
  } else {
    table(
      doc,
      ['Category', 'Total', 'Share (%)'],
      data.expenseCategories.map((category) => [
        category.name,
        formatMoney(category.total),
        formatPercent(category.percentage),
      ]),
      [0.6, 0.2, 0.2],
      [1, 2]
    );
  }

  sectionTitle(doc, 'Current Asset Position');
  note(doc, 'Live values from your assets today - not historical balances for the period.');
  table(
    doc,
    ['Metric', 'Value'],
    [
      ['Asset count', String(assets.assetCount)],
      ['Total assets', formatMoney(assets.totalAssets)],
    ],
    [0.6, 0.4],
    [1]
  );
  if (assets.assetCount === 0) {
    note(doc, 'No assets recorded.');
  } else {
    gap(doc, 6);
    table(
      doc,
      ['Asset type', 'Total', 'Share (%)'],
      assets.byType.map((group) => [
        group.type,
        formatMoney(group.totalValue),
        formatPercent(group.percentage),
      ]),
      [0.6, 0.2, 0.2],
      [1, 2]
    );
    gap(doc, 8);
    table(
      doc,
      ['Asset', 'Type', 'Current value', 'Share (%)'],
      assets.assets.map((asset) => [
        asset.name,
        asset.type,
        formatMoney(asset.currentValue),
        formatPercent(asset.percentage),
      ]),
      [0.34, 0.26, 0.22, 0.18],
      [2, 3]
    );
  }

  sectionTitle(doc, 'Current Liability Position');
  note(doc, 'Live balances you owe today - not historical balances for the period.');
  table(
    doc,
    ['Metric', 'Value'],
    [
      ['Liability count', String(liabilities.liabilityCount)],
      ['Total liabilities', formatMoney(liabilities.totalLiabilities)],
    ],
    [0.6, 0.4],
    [1]
  );
  if (liabilities.liabilityCount === 0) {
    note(doc, 'No liabilities recorded.');
  } else {
    gap(doc, 6);
    table(
      doc,
      ['Liability type', 'Outstanding balance', 'Share (%)'],
      liabilities.byType.map((group) => [
        group.type,
        formatMoney(group.totalBalance),
        formatPercent(group.percentage),
      ]),
      [0.6, 0.2, 0.2],
      [1, 2]
    );
    gap(doc, 8);
    table(
      doc,
      ['Liability', 'Type', 'Outstanding balance', 'Share (%)'],
      liabilities.liabilities.map((liability) => [
        liability.name,
        liability.type,
        formatMoney(liability.outstandingBalance),
        formatPercent(liability.percentage),
      ]),
      [0.34, 0.26, 0.22, 0.18],
      [2, 3]
    );
  }

  sectionTitle(doc, 'Net Worth');
  table(
    doc,
    ['Metric', 'Value'],
    [
      ['Current net worth', formatMoney(overview.netWorth)],
      ['Current total assets', formatMoney(overview.totalAssets)],
      ['Current total liabilities', formatMoney(overview.totalLiabilities)],
    ],
    [0.6, 0.4],
    [1]
  );
  gap(doc, 8);
  if (data.netWorthHistory.length === 0) {
    note(doc, 'No wealth snapshots in the selected period.');
  } else {
    table(
      doc,
      ['Snapshot date', 'Total assets', 'Total liabilities', 'Net worth'],
      data.netWorthHistory.map((point) => [
        formatDay(point.snapshotDate),
        formatMoney(point.totalAssets),
        formatMoney(point.totalLiabilities),
        formatMoney(point.netWorth),
      ]),
      [0.25, 0.25, 0.25, 0.25],
      [1, 2, 3]
    );
    note(doc, 'History comes from captured snapshots only; missing days are not interpolated.');
  }

  sectionTitle(doc, 'Savings Goals');
  note(doc, 'Goal savings are tracked separately and are never counted as assets or net worth.');
  table(
    doc,
    ['Metric', 'Value'],
    [
      ['Active goals', String(goals.activeCount)],
      ['Completed goals', String(goals.completedCount)],
      ['Total target amount', formatMoney(goals.totalTargetAmount)],
      ['Total saved amount', formatMoney(goals.totalSavedAmount)],
      ['Overall progress (%)', formatPercent(goals.progressPercent)],
    ],
    [0.6, 0.4],
    [1]
  );
  if (goals.items.length === 0) {
    gap(doc, 6);
    note(doc, 'No savings goals yet.');
  } else {
    gap(doc, 8);
    table(
      doc,
      ['Goal', 'Status', 'Target', 'Saved', 'Progress (%)'],
      goals.items.map((goal) => [
        goal.name,
        goal.status,
        formatMoney(goal.targetAmount),
        formatMoney(goal.currentAmount),
        formatPercent(goal.progressPercent),
      ]),
      [0.3, 0.16, 0.18, 0.18, 0.18],
      [2, 3, 4]
    );
  }

  writeFooters(doc);
}

function writeFooters(doc: PdfDoc): void {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `WealthHabit Financial Report · page ${index + 1} of ${range.count}`,
        MARGIN,
        doc.page.height - MARGIN - 10,
        { width: contentWidth(doc), align: 'center', lineBreak: false }
      );
  }
}
