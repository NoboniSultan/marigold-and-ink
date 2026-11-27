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
