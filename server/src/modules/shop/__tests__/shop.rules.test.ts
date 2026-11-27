import { describe, it, expect } from 'vitest';
import {
  PRODUCT_CATEGORIES,
  inStock,
  oneOfAKindProblem,
  priceRange,
  publishMissing,
} from '../shop.rules.ts';

const v = (priceCents: number, stock: number) => ({ priceCents, stock });

describe('shop rules', () => {
  it('has the four categories from the proposal', () => {
    expect(PRODUCT_CATEGORIES).toEqual(['jewelry', 'cards', 'stickers', 'upcycled']);
  });

  it('shows the lowest and highest price', () => {
    expect(priceRange([])).toBeNull();
    expect(priceRange([v(500, 1)])).toEqual({ from: 500, to: 500 });
    expect(priceRange([v(1800, 0), v(500, 2), v(900, 1)])).toEqual({ from: 500, to: 1800 });
  });

  it('is in stock when any option is', () => {
    expect(inStock([])).toBe(false);
    expect(inStock([v(500, 0), v(600, 0)])).toBe(false);
    expect(inStock([v(500, 0), v(600, 1)])).toBe(true);
  });

  it('lists what a product needs before publishing', () => {
    expect(publishMissing({ variants: [], photos: [] })).toEqual(['variant', 'photo']);
    expect(publishMissing({ variants: [{}], photos: [{ altText: null }] })).toEqual(['alt_text']);
    expect(publishMissing({ variants: [{}], photos: [{ altText: 'A vase' }] })).toEqual([]);
  });

  it('keeps a one-of-a-kind piece to one option with a stock of 0 or 1', () => {
    expect(oneOfAKindProblem(false, [v(500, 5), v(500, 5)])).toBeNull();
    expect(oneOfAKindProblem(true, [])).toBeNull();
    expect(oneOfAKindProblem(true, [v(5000, 1)])).toBeNull();
    expect(oneOfAKindProblem(true, [v(5000, 0)])).toBeNull();
    expect(oneOfAKindProblem(true, [v(5000, 1), v(5000, 0)])).toMatch(/single option/);
    expect(oneOfAKindProblem(true, [v(5000, 2)])).toMatch(/0 or 1/);
  });
});
