/**
 * Cart rules (milestone 12b): pure, so they're unit-tested on their own. A cart is only a
 * list of choices; prices and stock always come from the shop at the moment of checkout.
 */
import { multiplyCents, sumCents } from '../../lib/money.js';

/** At most this many of one item in an order (the database checks it too). */
export const MAX_QUANTITY = 100;
/** At most this many different items in one order. */
export const MAX_LINES = 50;

/** One line per item: repeated items are added together (capped at MAX_QUANTITY). */
export function mergeLines(
  lines: { variantId: number; quantity: number }[],
): { variantId: number; quantity: number }[] {
  const totals = new Map<number, number>();
  for (const { variantId, quantity } of lines) {
    totals.set(variantId, Math.min(MAX_QUANTITY, (totals.get(variantId) ?? 0) + quantity));
  }
  return [...totals].map(([variantId, quantity]) => ({ variantId, quantity }));
}

export function lineCents(unitPriceCents: number, quantity: number): number {
  return multiplyCents(unitPriceCents, quantity);
}

export function subtotalCents(lines: { unitPriceCents: number; quantity: number }[]): number {
  return sumCents(lines.map((l) => lineCents(l.unitPriceCents, l.quantity)));
}

/** How long stock is held while the customer pays (Stripe's shortest page life). */
export const HOLD_MINUTES = 30;
/** The sweep asks Stripe about a pending order this long after its page should have closed. */
export const SWEEP_GRACE_MS = 5 * 60_000;

/** USPS's heaviest package, in ounces (the shipping module checks sizes too). */
export const MAX_PACKAGE_OZ = 70 * 16;

export interface PackLine {
  quantity: number;
  pickupOnly: boolean;
  weightOz: number | null;
  packing: { lengthIn: number; widthIn: number; heightIn: number; weightOz: number } | null;
}

export type Packed =
  | { kind: 'pickup' }
  | {
      kind: 'ship';
      parcel: { weightOz: number; lengthIn: number; widthIn: number; heightIn: number };
    }
  | { kind: 'unavailable'; reason: 'missing_details' | 'too_heavy' };

/** Hundredths of an ounce or inch, so sums stay exact (two decimals, as stored). */
const hundredths = (n: number) => Math.round(n * 100);

/**
 * How an order reaches the customer (milestone 12c, ADR 0021):
 * - any pickup-only item (large furniture) makes the whole order a local pickup;
 * - otherwise it's packed into the largest packing type among its items (by volume), and
 *   weighs every item's packed weight times its quantity, plus the empty packing;
 * - an item without a packing type or weight can't be shipped yet.
 */
export function packOrder(lines: PackLine[]): Packed {
  if (lines.some((l) => l.pickupOnly)) return { kind: 'pickup' };
  if (lines.length === 0 || lines.some((l) => l.packing === null || l.weightOz === null)) {
    return { kind: 'unavailable', reason: 'missing_details' };
  }
  const volume = (p: NonNullable<PackLine['packing']>) => p.lengthIn * p.widthIn * p.heightIn;
  const box = lines
    .map((l) => l.packing!)
    .reduce((largest, p) => (volume(p) > volume(largest) ? p : largest));
  const weight =
    lines.reduce((sum, l) => sum + hundredths(l.weightOz!) * l.quantity, 0) +
    hundredths(box.weightOz);
  if (weight > MAX_PACKAGE_OZ * 100) return { kind: 'unavailable', reason: 'too_heavy' };
  return {
    kind: 'ship',
    parcel: {
      weightOz: weight / 100,
      lengthIn: box.lengthIn,
      widthIn: box.widthIn,
      heightIn: box.heightIn,
    },
  };
}
