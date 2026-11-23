import { describe, it, expect } from 'vitest';
import {
  SEED,
  SPROUT,
  SPROUT_AT,
  TREE,
  TREE_AT,
  growthFor,
  nearestStage,
  pathAt,
} from './treeStages.ts';

describe('growthFor', () => {
  it('is a seed at 0, a sprout at 50 trees, and a full tree at 200 (the owner’s thresholds)', () => {
    expect([SPROUT_AT, TREE_AT]).toEqual([50, 200]);
    expect(growthFor(0)).toBe(0);
    expect(growthFor(25)).toBe(0.5);
    expect(growthFor(50)).toBe(1);
    expect(growthFor(125)).toBe(1.5);
    expect(growthFor(200)).toBe(2);
    expect(growthFor(5000)).toBe(2);
  });

  it('treats a negative count as nothing grown', () => {
    expect(growthFor(-3)).toBe(0);
  });
});

describe('pathAt', () => {
  it('draws the exact stages at their growth, clamping outside 0–2', () => {
    expect(pathAt(0)).toBe(SEED);
    expect(pathAt(-1)).toBe(SEED);
    expect(pathAt(2)).toBe(TREE);
    expect(pathAt(9)).toBe(TREE);
  });

  it('morphs between stages in between', () => {
    for (const growth of [0.25, 1, 1.75]) {
      const d = pathAt(growth);
      expect(d).toMatch(/^M/);
      expect([SEED, TREE]).not.toContain(d);
    }
    expect(pathAt(0.5)).not.toBe(pathAt(1.5));
  });
});

describe('nearestStage', () => {
  it('picks the closest whole stage, for reduced motion', () => {
    expect(nearestStage(0.4)).toBe(SEED);
    expect(nearestStage(0.5)).toBe(SPROUT);
    expect(nearestStage(1.4)).toBe(SPROUT);
    expect(nearestStage(1.5)).toBe(TREE);
  });
});
