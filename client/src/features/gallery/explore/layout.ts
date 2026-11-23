/**
 * Where each artwork goes on the cylinder: two rows, `perRow` slots each. Pure, so it is
 * unit-tested without WebGL.
 *
 * - Large collections: every artwork appears exactly once, alternating rows.
 * - Small collections: the room would look empty, so artworks repeat. Each row repeats
 *   the whole list a whole number of times, so copies of a piece sit evenly around the
 *   room (opposite each other when shown twice) and never appear side by side. The bottom
 *   row is shifted by half the list, so the two rows don't line up the same pieces.
 */
export const MIN_PER_ROW = 9;

export interface Slot {
  /** Index into the artworks array. */
  artwork: number;
  row: 0 | 1;
  column: number;
}

export function layoutSlots(count: number): { perRow: number; slots: Slot[] } {
  if (count === 0) return { perRow: MIN_PER_ROW, slots: [] };

  if (count >= MIN_PER_ROW * 2) {
    const perRow = Math.ceil(count / 2);
    const slots = Array.from({ length: count }, (_, i) => ({
      artwork: i,
      row: (i % 2) as 0 | 1,
      column: Math.floor(i / 2),
    }));
    return { perRow, slots };
  }

  const perRow = count * Math.ceil(MIN_PER_ROW / count);
  // Rounding the half up puts a piece's top and bottom copies furthest apart around the ring.
  const shift = Math.ceil(count / 2);
  const slots: Slot[] = [];
  for (const row of [0, 1] as const) {
    for (let column = 0; column < perRow; column++) {
      slots.push({ artwork: (column + row * shift) % count, row, column });
    }
  }
  return { perRow, slots };
}

/**
 * Mixes black-and-white and coloured pieces for the 3D room, so neither kind bunches
 * together: the smaller group is spread evenly through the larger one, and each group
 * keeps its own order. (Slots alternate rows by index, and the even spacing alternates
 * odd and even positions, so both rows get some of each.)
 */
export function mixTones<T>(items: readonly T[], isMonochrome: (item: T) => boolean): T[] {
  const mono = items.filter(isMonochrome);
  const colour = items.filter((item) => !isMonochrome(item));
  const [many, few] = mono.length >= colour.length ? [mono, colour] : [colour, mono];
  if (few.length === 0) return [...many];

  const n = items.length;
  // The k-th piece of the smaller group goes in the middle of its even share of the line.
  const fewAt = new Set(few.map((_, k) => Math.floor(((k + 0.5) * n) / few.length)));
  const result: T[] = [];
  let f = 0;
  let m = 0;
  for (let i = 0; i < n; i++) result.push(fewAt.has(i) ? few[f++]! : many[m++]!);
  return result;
}

/** How far a card strays from its slot, so the wall looks hung by hand, not on a grid. */
export interface Scatter {
  /** Fraction of the angle between slots (−0.18 to 0.18). */
  angle: number;
  /** Up or down, in scene units (−0.3 to 0.3). */
  y: number;
  /** Toward the viewer (negative) or the wall (−0.45 to 0.25), so overlaps never flicker. */
  depth: number;
  /** A slight tilt around the viewing axis, in radians (−0.05 to 0.05). */
  roll: number;
}

/** A small deterministic random generator (mulberry32): the same slot always strays alike. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scatterFor(slotIndex: number): Scatter {
  const next = random(slotIndex + 1);
  const between = (min: number, max: number) => min + next() * (max - min);
  return {
    angle: between(-0.18, 0.18),
    y: between(-0.3, 0.3),
    depth: between(-0.45, 0.25),
    roll: between(-0.05, 0.05),
  };
}
