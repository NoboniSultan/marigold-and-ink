/**
 * Mixes black-and-white and coloured pieces so neither kind bunches together (the 3D
 * sketchbook, the Home carousel): the smaller group is spread evenly through the larger
 * one, and each group keeps its own order.
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
