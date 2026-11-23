/**
 * The Giving page's growing tree: seed → sprout → tree, as one closed SVG path each (so
 * flubber can morph between them), on a 100 × 100 grid with the ground at y = 95.
 * Pure: no React, no DOM, so it's unit-tested directly.
 */
import { interpolate } from 'flubber';

export const SEED =
  'M50 72 C58 72 62 80 62 86 C62 92 56 95 50 95 C44 95 38 92 38 86 C38 80 42 72 50 72 Z';
export const SPROUT =
  'M48 95 L48 62 C40 64 30 58 28 46 C40 44 48 50 49 58 L49 52 C50 42 58 34 72 34 C70 48 60 56 52 56 L52 95 Z';
export const TREE =
  'M46 95 L46 66 C30 66 18 56 18 42 C18 26 32 14 50 14 C68 14 82 26 82 42 C82 56 70 66 54 66 L54 95 Z';

/** Trees funded at which the sprout, then the full tree, is reached (the owner's choice). */
export const SPROUT_AT = 50;
export const TREE_AT = 200;

/**
 * How far the tree has grown: 0 = seed, 1 = sprout (at SPROUT_AT trees), 2 = full tree (at
 * TREE_AT and beyond), in between for counts in between.
 */
export function growthFor(trees: number): number {
  if (trees <= 0) return 0;
  if (trees < SPROUT_AT) return trees / SPROUT_AT;
  return 1 + Math.min((trees - SPROUT_AT) / (TREE_AT - SPROUT_AT), 1);
}

const seedToSprout = interpolate(SEED, SPROUT, { maxSegmentLength: 4 });
const sproutToTree = interpolate(SPROUT, TREE, { maxSegmentLength: 4 });

/** The path at a growth between 0 and 2. */
export function pathAt(growth: number): string {
  const g = Math.min(Math.max(growth, 0), 2);
  if (g === 0) return SEED;
  if (g === 2) return TREE;
  return g <= 1 ? seedToSprout(g) : sproutToTree(g - 1);
}

/** Without motion: the stage closest to the growth, drawn whole. */
export function nearestStage(growth: number): string {
  if (growth < 0.5) return SEED;
  return growth < 1.5 ? SPROUT : TREE;
}
