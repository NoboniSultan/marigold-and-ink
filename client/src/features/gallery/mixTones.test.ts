import { describe, it, expect } from 'vitest';
import { layoutSlots } from './explore/layout.ts';
import { mixTones } from './mixTones.ts';

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
