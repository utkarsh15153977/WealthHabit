import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { getAuthenticatedUserId } from '../middleware/ownershipMiddleware.js';
import type { AnalyticsRange } from '../schemas/reportSchemas.js';
import { buildFinancialReportData } from '../services/reportDataService.js';
import { renderFinancialReportCsv } from '../services/reportCsvService.js';
import { renderFinancialReportPdf } from '../services/reportPdfService.js';
import { reportFileName } from '../utils/reportFormat.js';

/**
 * Every report handler is an authenticated GET. The user id always comes from
 * the access token — never from the query, the body or the route — and the
 * range has already been coerced, defaulted and bounded by the route schema,
 * so the request contributes no financial value of its own.
 *
 * The three handlers share one builder: JSON, CSV and PDF are three
 * renderings of the same FinancialReportData, never three calculations.
 */
function rangeFromRequest(req: AuthenticatedRequest): AnalyticsRange {
  return (req.query ?? {}) as unknown as AnalyticsRange;
}

export async function getFinancialReportHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);

  const data = await buildFinancialReportData(userId, rangeFromRequest(req));

  res.json({ success: true, data });
}

export async function getFinancialReportCsvHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const generatedAt = new Date();

  const data = await buildFinancialReportData(userId, rangeFromRequest(req));
  const csv = renderFinancialReportCsv(data, generatedAt);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${reportFileName(data, 'csv')}"`
  );
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(csv);
}

export async function getFinancialReportPdfHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const userId = getAuthenticatedUserId(req);
  const generatedAt = new Date();

  const data = await buildFinancialReportData(userId, rangeFromRequest(req));
  const pdf = await renderFinancialReportPdf(data, generatedAt);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${reportFileName(data, 'pdf')}"`
  );
  res.setHeader('Content-Length', String(pdf.byteLength));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(pdf);
}
