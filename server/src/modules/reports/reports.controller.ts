import type { Request, Response } from 'express';
import type { ApiResponse } from '@shared/types/api.ts';
import { monthInBusinessZone } from '../../lib/businessTime.ts';
import type { MonthlyReportRow } from '@shared/types/admin.ts';
import * as reportsService from './reports.service.ts';

function yearOf(req: Request): number {
  const { year } = req.validated.query as { year?: number };
  return year ?? monthInBusinessZone().year;
}

export async function monthly(req: Request, res: Response) {
  const rows = await reportsService.monthlyReport(yearOf(req));
  res.json({ data: rows } satisfies ApiResponse<MonthlyReportRow[]>);
}

/** The same report as a CSV download, for bookkeeping. */
export async function monthlyCsv(req: Request, res: Response) {
  const year = yearOf(req);
  const rows = await reportsService.monthlyReport(year);
  res.attachment(`marigold-and-ink-report-${year}.csv`);
  res.type('text/csv; charset=utf-8').send(reportsService.toCsv(rows));
}
