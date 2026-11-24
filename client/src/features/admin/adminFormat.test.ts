import { describe, it, expect } from 'vitest';
import { STATUSES, dollarsToCents, formatDate, statusLabel } from './adminFormat.ts';

describe('dollarsToCents', () => {
  it('reads dollars exactly, with or without cents, a dollar sign, or commas', () => {
    expect(dollarsToCents('125')).toBe(12500);
    expect(dollarsToCents('125.5')).toBe(12550);
    expect(dollarsToCents('0.29')).toBe(29);
    expect(dollarsToCents(' $1,250.00 ')).toBe(125000);
  });

  it('refuses anything that is not an amount', () => {
    for (const typed of ['', 'abc', '12.345', '-5', '1e3', '.5']) {
      expect(dollarsToCents(typed)).toBeNull();
    }
  });
});

describe('statusLabel and STATUSES', () => {
  it('reads a status as words', () => {
    expect(statusLabel('awaiting_final_payment')).toBe('Awaiting final payment');
    expect(STATUSES[0]).toBe('inquiry');
    expect(STATUSES).toContain('refunded');
  });
});

describe('formatDate', () => {
  it('shows a calendar date as that day, whatever the time zone', () => {
    expect(formatDate('2026-11-20')).toBe('Nov 20, 2026');
    expect(formatDate(null)).toBe('–');
  });
});
