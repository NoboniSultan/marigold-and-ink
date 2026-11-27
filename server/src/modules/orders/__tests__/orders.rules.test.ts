import { describe, it, expect } from 'vitest';
import { MAX_QUANTITY, lineCents, mergeLines, subtotalCents } from '../orders.rules.ts';

describe('cart rules', () => {
  it('adds repeated items together, capped', () => {
    expect(
      mergeLines([
        { variantId: 1, quantity: 2 },
        { variantId: 2, quantity: 1 },
        { variantId: 1, quantity: 3 },
      ]),
    ).toEqual([
      { variantId: 1, quantity: 5 },
      { variantId: 2, quantity: 1 },
    ]);
    expect(
      mergeLines([
        { variantId: 1, quantity: MAX_QUANTITY },
        { variantId: 1, quantity: 1 },
      ]),
    ).toEqual([{ variantId: 1, quantity: MAX_QUANTITY }]);
  });

  it('totals lines in exact cents', () => {
    expect(lineCents(450, 3)).toBe(1350);
    expect(
      subtotalCents([
        { unitPriceCents: 450, quantity: 3 },
        { unitPriceCents: 1999, quantity: 1 },
      ]),
    ).toBe(3349);
  });
});
