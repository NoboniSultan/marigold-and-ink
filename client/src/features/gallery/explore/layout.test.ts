import { describe, it, expect } from 'vitest';
import { MIN_PER_ROW, layoutSlots, mixTones, scatterFor, type Slot } from './layout.ts';

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

describe('mixTones', () => {
  const pieces = (mono: number, colour: number) => [
    ...Array.from({ length: mono }, (_, i) => ({ id: `m${i}`, mono: true })),
    ...Array.from({ length: colour }, (_, i) => ({ id: `c${i}`, mono: false })),
  ];

  it('spreads the smaller group evenly, keeping each group in order', () => {
    const mixed = mixTones(pieces(24, 13), (p) => p.mono);

    expect(mixed).toHaveLength(37);
    expect(mixed.filter((p) => p.mono).map((p) => p.id)).toEqual(pieces(24, 0).map((p) => p.id));
    expect(mixed.filter((p) => !p.mono).map((p) => p.id)).toEqual(pieces(0, 13).map((p) => p.id));
    // Never more than three black-and-white pieces in a row along the line.
    const runs = mixed
      .map((p) => (p.mono ? 'm' : 'c'))
      .join('')
      .split('c');
    expect(Math.max(...runs.map((run) => run.length))).toBeLessThanOrEqual(3);
  });

  it('puts both kinds in both rows of the room', () => {
    const { slots } = layoutSlots(37);
    const mixed = mixTones(pieces(24, 13), (p) => p.mono);
    for (const row of [0, 1]) {
      const kinds = new Set(slots.filter((s) => s.row === row).map((s) => mixed[s.artwork]!.mono));
      expect(kinds).toEqual(new Set([true, false]));
    }
  });

  it('leaves a single-kind collection as it is', () => {
    const all = pieces(5, 0);
    expect(mixTones(all, (p) => p.mono)).toEqual(all);
    expect(mixTones([], () => true)).toEqual([]);
  });
});

describe('scatterFor', () => {
  it('strays within its limits, and the same slot always strays the same way', () => {
    for (let slot = 0; slot < 200; slot++) {
      const s = scatterFor(slot);
      expect(Math.abs(s.angle)).toBeLessThanOrEqual(0.18);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(0.3);
      expect(s.depth).toBeGreaterThanOrEqual(-0.45);
      expect(s.depth).toBeLessThanOrEqual(0.25);
      expect(Math.abs(s.roll)).toBeLessThanOrEqual(0.05);
      expect(scatterFor(slot)).toEqual(s);
    }
  });

  it('gives neighbouring slots different positions', () => {
    expect(scatterFor(0)).not.toEqual(scatterFor(1));
  });
});
