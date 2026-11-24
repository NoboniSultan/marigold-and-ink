/**
 * The monthly report (milestone 9, ADR 0015): money in and out, and tree money, per month
 * in New York time. It combines the payments and giving services' monthly totals.
 */
import type { MonthlyReportRow } from '@shared/types/admin.ts';
import * as givingService from '../giving/giving.service.ts';
import * as paymentsService from '../payments/payments.service.ts';
import { BUSINESS_TIME_ZONE, monthInBusinessZone } from '../../lib/businessTime.ts';

/** Every month of `year` up to the current one (none ahead). */
export async function monthlyReport(year: number, now = new Date()): Promise<MonthlyReportRow[]> {
  const [payments, giving] = await Promise.all([
    paymentsService.monthlyPayments(year, BUSINESS_TIME_ZONE),
    givingService.monthlyGiving(year, BUSINESS_TIME_ZONE),
  ]);
  const current = monthInBusinessZone(now).month;
  return payments
    .map((p, i) => {
      const g = giving[i]!;
      return {
        month: p.month,
        salesCents: p.salesCents,
        refundsCents: p.refundsCents,
        netSalesCents: p.salesCents - p.refundsCents,
        treesOrdered: g.treesOrdered,
        treesOrderedCents: g.treesOrderedCents,
        donationsPaidCents: g.donationsPaidCents,
        donationsOwedAtMonthEndCents: g.donationsOwedAtMonthEndCents,
      };
    })
    .filter((row) => row.month <= current);
}

/** Cents as plain dollars for a spreadsheet: 12345 → "123.45", -5 → "-0.05". Exact. */
export function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * The report as CSV for bookkeeping: one row per month, then a total row. The total's
 * "owed" column is the last month's (what's still owed now), not a sum.
 */
export function toCsv(rows: MonthlyReportRow[]): string {
  const header = [
    'Month',
    'Sales (USD)',
    'Refunds (USD)',
    'Net sales (USD)',
    'Trees ordered',
    'Trees ordered (USD)',
    'Donations paid (USD)',
    'Donations owed at month end (USD)',
  ];
  const line = (row: MonthlyReportRow, label = row.month) =>
    [
      label,
      dollars(row.salesCents),
      dollars(row.refundsCents),
      dollars(row.netSalesCents),
      String(row.treesOrdered),
      dollars(row.treesOrderedCents),
      dollars(row.donationsPaidCents),
      dollars(row.donationsOwedAtMonthEndCents),
    ].join(',');
  const sum = (pick: (row: MonthlyReportRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const total: MonthlyReportRow = {
    month: 'Total',
    salesCents: sum((r) => r.salesCents),
    refundsCents: sum((r) => r.refundsCents),
    netSalesCents: sum((r) => r.netSalesCents),
    treesOrdered: sum((r) => r.treesOrdered),
    treesOrderedCents: sum((r) => r.treesOrderedCents),
    donationsPaidCents: sum((r) => r.donationsPaidCents),
    donationsOwedAtMonthEndCents: rows.at(-1)?.donationsOwedAtMonthEndCents ?? 0,
  };
  return [header.join(','), ...rows.map((row) => line(row)), line(total)].join('\r\n') + '\r\n';
}
