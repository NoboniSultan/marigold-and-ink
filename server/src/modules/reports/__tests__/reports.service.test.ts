import { describe, it, expect } from 'vitest';
import type { MonthlyReportRow } from '@shared/types/admin.ts';
import { dollars, toCsv } from '../reports.service.ts';
import { monthInBusinessZone, todayInBusinessZone } from '../../../lib/businessTime.ts';

describe('dollars', () => {
  it('writes cents as exact dollars', () => {
    expect(dollars(12345)).toBe('123.45');
    expect(dollars(5)).toBe('0.05');
    expect(dollars(0)).toBe('0.00');
    expect(dollars(-2005)).toBe('-20.05');
  });
});

describe('toCsv', () => {
  const row = (month: string, cents: number, owed: number): MonthlyReportRow => ({
    month,
    salesCents: cents,
    refundsCents: 100,
    netSalesCents: cents - 100,
    treesOrdered: 2,
    treesOrderedCents: 200,
    donationsPaidCents: 50,
    donationsOwedAtMonthEndCents: owed,
  });

  it('writes a header, one line per month, and a total (owed is the last month, not a sum)', () => {
    const csv = toCsv([row('2026-01', 1000, 300), row('2026-02', 2000, 450)]);

    expect(csv.split('\r\n')).toEqual([
      'Month,Sales (USD),Refunds (USD),Net sales (USD),Trees ordered,Trees ordered (USD),Donations paid (USD),Donations owed at month end (USD)',
      '2026-01,10.00,1.00,9.00,2,2.00,0.50,3.00',
      '2026-02,20.00,1.00,19.00,2,2.00,0.50,4.50',
      'Total,30.00,2.00,28.00,4,4.00,1.00,4.50',
      '',
    ]);
  });

  it('has a zero total for an empty report', () => {
    expect(toCsv([]).split('\r\n')[1]).toBe('Total,0.00,0.00,0.00,0,0.00,0.00,0.00');
  });
});

describe('business time (New York)', () => {
  it('counts the day and month in New York, not UTC', () => {
    // 3:30 am UTC on February 1st is still January 31st in New York.
    const lateJanuary = new Date('2026-02-01T03:30:00Z');
    expect(todayInBusinessZone(lateJanuary)).toBe('2026-01-31');
    expect(monthInBusinessZone(lateJanuary)).toEqual({ year: 2026, month: '2026-01' });
  });
});
