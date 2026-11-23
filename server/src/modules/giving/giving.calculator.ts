/**
 * Pure giving arithmetic, in integer cents (ADR 0013). No database, no HTTP.
 */
import { percentOfCents } from '../../lib/money.js';

/** Digital Humani: every tree costs $1, invoiced by the planting partner. */
export const TREE_PRICE_CENTS = 100;

/**
 * The trees a fully paid commission funds: `percent` of its full price, rounded UP to whole
 * trees, so the share given is never below the promise ($27.50 → 28 trees, $28.00).
 * Capped at the price itself for tiny amounts, where one tree would cost more than the
 * commission; then no tree is funded rather than more than everything.
 */
export function treesFor(
  totalCents: number,
  percent: number,
): { treeCount: number; donationCents: number } {
  const share = percentOfCents(totalCents, percent);
  let treeCount = Math.ceil(share / TREE_PRICE_CENTS);
  if (treeCount * TREE_PRICE_CENTS > totalCents) {
    treeCount = Math.floor(totalCents / TREE_PRICE_CENTS);
  }
  return { treeCount, donationCents: treeCount * TREE_PRICE_CENTS };
}

/**
 * How much of a commission can still be refunded: what was paid, minus what's already
 * refunded (or on its way back), minus the tree money. Trees can't be un-requested, so
 * their cost is never refunded (the owner's decision, milestone 8). Never below zero.
 */
export function refundableCents({
  paidCents,
  refundedCents,
  withheldForTreesCents,
}: {
  paidCents: number;
  refundedCents: number;
  withheldForTreesCents: number;
}): number {
  return Math.max(0, paidCents - refundedCents - withheldForTreesCents);
}
