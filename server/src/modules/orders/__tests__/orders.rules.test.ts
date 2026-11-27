import { describe, it, expect } from 'vitest';
import {
  MAX_QUANTITY,
  lineCents,
  mergeLines,
  packOrder,
  subtotalCents,
  type PackLine,
} from '../orders.rules.ts';

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

describe('packOrder', () => {
  const mailer = { lengthIn: 9.5, widthIn: 6.5, heightIn: 0.5, weightOz: 0.4 };
  const box = { lengthIn: 8, widthIn: 8, heightIn: 4, weightOz: 5.25 };
  const line = (overrides: Partial<PackLine> = {}): PackLine => ({
    quantity: 1,
    pickupOnly: false,
    weightOz: 1,
    packing: mailer,
    ...overrides,
  });

  it('packs everything into the largest packing, weighing items and packing exactly', () => {
    expect(
      packOrder([line({ weightOz: 0.3, quantity: 3 }), line({ weightOz: 2.15, packing: box })]),
    ).toEqual({
      kind: 'ship',
      parcel: { weightOz: 8.3, lengthIn: 8, widthIn: 8, heightIn: 4 }, // 0.9 + 2.15 + 5.25
    });
    // The largest wins whichever item comes first.
    expect(packOrder([line({ packing: box }), line()])).toMatchObject({
      parcel: { lengthIn: 8, widthIn: 8, heightIn: 4 },
    });
    expect(packOrder([line()])).toEqual({
      kind: 'ship',
      parcel: { weightOz: 1.4, lengthIn: 9.5, widthIn: 6.5, heightIn: 0.5 },
    });
  });

  it('makes the whole order a pickup if any item is pickup only', () => {
    expect(packOrder([line(), line({ pickupOnly: true, packing: null, weightOz: null })])).toEqual({
      kind: 'pickup',
    });
  });

  it("can't ship items without their details, nothing, or over 70 lb", () => {
    for (const lines of [[line({ packing: null })], [line({ weightOz: null })], []]) {
      expect(packOrder(lines)).toEqual({ kind: 'unavailable', reason: 'missing_details' });
    }
    expect(packOrder([line({ weightOz: 1120 })])).toEqual({
      kind: 'unavailable',
      reason: 'too_heavy',
    });
  });
});
