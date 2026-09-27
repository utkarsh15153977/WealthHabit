import api from './api';
import type { ApiResponse } from '../types/api';
import type {
  FinancialReport,
  ReportDownload,
  ReportRangeParams,
} from '../types/report';

function unwrapData<T>(payload: ApiResponse<T>): T {
  if (!payload.success || payload.data === undefined) {
    throw new Error(payload.message || 'Unexpected server response');
  }
  return payload.data;
}

function rangeQuery(params: ReportRangeParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.dateFrom) query.dateFrom = params.dateFrom;
  if (params.dateTo) query.dateTo = params.dateTo;
  return query;
}

function rangeParams(params: ReportRangeParams): Record<string, string> | undefined {
  const query = rangeQuery(params);
  return Object.keys(query).length > 0 ? query : undefined;
}

function utcToday(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fileNameFromDisposition(header: string | undefined, fallback: string): string {
  if (!header) return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] ?? fallback;
}

async function download(
  path: string,
  params: ReportRangeParams,
  extension: 'csv' | 'pdf'
): Promise<ReportDownload> {
  const response = await api.get(path, {
    params: rangeParams(params),
    responseType: 'blob',
    headers: { Accept: extension === 'csv' ? 'text/csv' : 'application/pdf' },
  });

  const fallback = `wealthhabit-financial-report-${
    params.dateTo ? params.dateTo.slice(0, 10) : utcToday()
  }.${extension}`;

  return {
    blob: response.data as Blob,
    fileName: fileNameFromDisposition(
      response.headers?.['content-disposition'] as string | undefined,
      fallback
    ),
  };
}

/** JSON preview: the same object the CSV and PDF renderings are built from. */
export async function getFinancialReport(
  params: ReportRangeParams = {}
): Promise<FinancialReport> {
  const response = await api.get<ApiResponse<FinancialReport>>(
    '/reports/financial',
    { params: rangeParams(params) }
  );
  return unwrapData(response.data);
}

export function downloadFinancialReportCsv(
  params: ReportRangeParams = {}
): Promise<ReportDownload> {
  return download('/reports/financial.csv', params, 'csv');
}

export function downloadFinancialReportPdf(
  params: ReportRangeParams = {}
): Promise<ReportDownload> {
  return download('/reports/financial.pdf', params, 'pdf');
}

/**
 * Hands the finished blob to the browser. Reports are read only, so this is
 * the only "side effect" the report client ever performs.
 */
export function saveReportFile({ blob, fileName }: ReportDownload): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Every report call is a GET: there is no create, update or delete helper
 * here because a report never writes to a financial record.
 */
export const reportApi = {
  getFinancialReport,
  downloadFinancialReportCsv,
  downloadFinancialReportPdf,
  saveReportFile,
};
