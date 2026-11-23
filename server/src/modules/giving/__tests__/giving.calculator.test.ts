import { describe, it, expect } from 'vitest';
import { refundableCents, treesFor, TREE_PRICE_CENTS } from '../giving.calculator.ts';

describe('treesFor', () => {
  it('rounds the share UP to whole $1 trees, so it is never below the promise', () => {
    expect(treesFor(11_000, 25)).toEqual({ treeCount: 28, donationCents: 2_800 }); // $27.50
    expect(treesFor(10_000, 25)).toEqual({ treeCount: 25, donationCents: 2_500 }); // exact
    expect(treesFor(10_050, 25)).toEqual({ treeCount: 26, donationCents: 2_600 }); // $25.13
  });

  it('costs $1 a tree', () => {
    expect(TREE_PRICE_CENTS).toBe(100);
  });

  it('never funds more than the commission itself costs', () => {
    expect(treesFor(150, 25)).toEqual({ treeCount: 1, donationCents: 100 }); // 38¢ → 1 tree
    expect(treesFor(99, 25)).toEqual({ treeCount: 0, donationCents: 0 }); // 1 tree > 99¢
    expect(treesFor(0, 25)).toEqual({ treeCount: 0, donationCents: 0 });
  });
});

describe('refundableCents', () => {
  it('is what was paid, less refunds and the tree money', () => {
    expect(
      refundableCents({ paidCents: 10_000, refundedCents: 5_000, withheldForTreesCents: 2_500 }),
    ).toBe(2_500);
  });

  it('never goes below zero', () => {
    expect(
      refundableCents({ paidCents: 10_000, refundedCents: 9_000, withheldForTreesCents: 2_500 }),
    ).toBe(0);
  });
});
