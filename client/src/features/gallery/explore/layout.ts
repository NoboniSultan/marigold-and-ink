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
