/**
 * The shop catalog's rules (milestone 12a, ADR 0019): categories, prices shown, availability,
 * what a product needs before it's published, and one-of-a-kind pieces. Pure, so they're
 * unit-tested on their own.
 */
import type { ProductCategory } from '@shared/types/shop.ts';

/** The four categories from the proposal (section 4). */
export const PRODUCT_CATEGORIES = [
  'jewelry',
  'cards',
  'stickers',
  'upcycled',
] as const satisfies readonly ProductCategory[];

interface VariantLike {
  priceCents: number;
  stock: number;
}

/** The lowest and highest prices, or null without variants. */
export function priceRange(variants: VariantLike[]): { from: number; to: number } | null {
  if (variants.length === 0) return null;
  const prices = variants.map((v) => v.priceCents);
  return { from: Math.min(...prices), to: Math.max(...prices) };
}

export function inStock(variants: VariantLike[]): boolean {
  return variants.some((v) => v.stock > 0);
}

/** What still stops a product from being published: a variant, a photo, every photo's alt text. */
export function publishMissing({
  variants,
  photos,
}: {
  variants: unknown[];
  photos: { altText: string | null }[];
}): ('variant' | 'photo' | 'alt_text')[] {
  return [
    ...(variants.length === 0 ? (['variant'] as const) : []),
    ...(photos.length === 0 ? (['photo'] as const) : []),
    ...(photos.some((p) => !p.altText) ? (['alt_text'] as const) : []),
  ];
}

/**
 * A one-of-a-kind piece has a single variant with a stock of 0 or 1. Returns why the given
 * variants break that, or null when they don't (or the product isn't one of a kind).
 */
export function oneOfAKindProblem(oneOfAKind: boolean, variants: VariantLike[]): string | null {
  if (!oneOfAKind) return null;
  if (variants.length > 1) return 'A one-of-a-kind piece has a single option';
  if (variants.some((v) => v.stock > 1)) return 'A one-of-a-kind piece has a stock of 0 or 1';
  return null;
}
