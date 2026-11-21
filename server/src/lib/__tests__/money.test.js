import { describe, it, expect } from 'vitest';
import { assertCents, percentOfCents, splitDeposit, sumCents, formatCents } from '../money.js';

describe('assertCents', () => {
  it.each([0, 1, 123456])('accepts %i', (value) => {
    expect(assertCents(value)).toBe(value);
  });

  it.each([-1, 1.5, NaN, Infinity, '100', null, 2 ** 53])('rejects %s', (value) => {
    expect(() => assertCents(value)).toThrow(TypeError);
  });
});

describe('percentOfCents', () => {
  it.each([
    [10000, 25, 2500],
    [1001, 25, 250], // 250.25 -> rounds down
    [1002, 25, 251], // 250.50 -> rounds half up
    [1003, 25, 251], // 250.75 -> rounds up
    [1, 50, 1], // 0.5 cent -> rounds half up to 1
    [1, 49, 0],
    [0, 25, 0],
    [12345, 0, 0],
    [12345, 100, 12345],
    [10000, 33.33, 3333],
    [10001, 12.5, 1250], // 1250.125 -> 1250
  ])('%i cents x %s%% = %i', (amount, percent, expected) => {
    expect(percentOfCents(amount, percent)).toBe(expected);
  });

  it('handles large amounts exactly (no floating-point drift)', () => {
    // $9,999,999,999.99 at 25%
    expect(percentOfCents(999_999_999_999, 25)).toBe(250_000_000_000);
  });

  it.each([-1, 100.01, NaN])('rejects percent %s', (percent) => {
    expect(() => percentOfCents(1000, percent)).toThrow(RangeError);
  });

  it('rejects more than two decimal places', () => {
    expect(() => percentOfCents(1000, 12.345)).toThrow(/two decimal/);
  });

  it('rejects non-integer cents', () => {
    expect(() => percentOfCents(10.5, 25)).toThrow(TypeError);
  });
});

describe('splitDeposit', () => {
  it('splits so deposit + balance always equals the total', () => {
    for (const total of [0, 1, 99, 1001, 12345, 99999]) {
      for (const pct of [0, 25, 33.33, 50, 100]) {
        const { depositCents, balanceCents } = splitDeposit(total, pct);
        expect(depositCents + balanceCents).toBe(total);
        expect(balanceCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('rounds the deposit half up and gives the remainder to the balance', () => {
    expect(splitDeposit(1001, 50)).toEqual({ depositCents: 501, balanceCents: 500 });
  });
});

describe('sumCents', () => {
  it('adds integer cents', () => {
    expect(sumCents([100, 250, 1])).toBe(351);
    expect(sumCents([])).toBe(0);
  });

  it('refuses floats', () => {
    expect(() => sumCents([100, 0.5])).toThrow(TypeError);
  });
});

describe('formatCents', () => {
  it('formats for display', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(5)).toBe('$0.05');
  });
});
