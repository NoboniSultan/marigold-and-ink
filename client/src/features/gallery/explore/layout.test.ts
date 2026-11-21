import { describe, it, expect } from 'vitest';
import { MIN_PER_ROW, layoutSlots, type Slot } from './layout.ts';

/** Smallest distance (in columns, around the ring) between two copies of one artwork in a row. */
function closestRepeat(slots: Slot[], perRow: number): number {
  let closest = Infinity;
  for (const a of slots) {
    for (const b of slots) {
      if (a === b || a.row !== b.row || a.artwork !== b.artwork) continue;
      const gap = Math.abs(a.column - b.column);
      closest = Math.min(closest, gap, perRow - gap);
    }
  }
  return closest;
}

describe('layoutSlots', () => {
  it('shows a large collection once each, alternating rows', () => {
    const { perRow, slots } = layoutSlots(20);
    expect(perRow).toBe(10);
    expect(slots.map((s) => s.artwork)).toEqual([...Array(20).keys()]);
    expect(slots.slice(0, 3)).toEqual([
      { artwork: 0, row: 0, column: 0 },
      { artwork: 1, row: 1, column: 0 },
      { artwork: 2, row: 0, column: 1 },
    ]);
  });

  it.each([1, 2, 3, 5, 7, 9, 12])(
    'fills the room with %i artworks, keeping copies of a piece far apart',
    (count) => {
      const { perRow, slots } = layoutSlots(count);
      expect(perRow).toBeGreaterThanOrEqual(MIN_PER_ROW);
      expect(perRow % count).toBe(0);
      expect(slots).toHaveLength(perRow * 2);
      // Copies are a full list apart: at least 7 columns for 7 pieces (opposite sides).
      if (count > 1)
        expect(closestRepeat(slots, perRow)).toBeGreaterThanOrEqual(Math.min(count, perRow / 2));
    },
  );

  it('offsets the rows so the same piece is not stacked above itself', () => {
    const { slots, perRow } = layoutSlots(7);
    const top = slots.filter((s) => s.row === 0).map((s) => s.artwork);
    const bottom = slots.filter((s) => s.row === 1).map((s) => s.artwork);
    expect(top.some((a, column) => a === bottom[column])).toBe(false);
    expect(perRow).toBe(14);
  });

  it('handles an empty gallery', () => {
    expect(layoutSlots(0).slots).toEqual([]);
  });
});
