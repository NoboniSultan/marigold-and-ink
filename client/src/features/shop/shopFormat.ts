import type { ProductCategory, ProductSummary } from '@shared/types/shop.ts';
import { COPY } from '../../content/copy.ts';
import { formatMoney } from '../commissions/money.ts';

/** The four categories in the order the shop shows them. */
export const CATEGORIES = Object.keys(COPY.shop.categories) as ProductCategory[];

export function isCategory(value: string | null): value is ProductCategory {
  return value !== null && (CATEGORIES as string[]).includes(value);
}

export const usd = (cents: number) => formatMoney(cents, 'usd');

/** "$4.00", or "From $4.00" when the options cost different amounts. */
export function priceText(product: Pick<ProductSummary, 'priceFromCents' | 'priceToCents'>) {
  return product.priceFromCents === product.priceToCents
    ? usd(product.priceFromCents)
    : `From ${usd(product.priceFromCents)}`;
}

/** A one-of-a-kind piece that sold is "Sold"; anything else out of stock is "Sold out". */
export function soldText(product: Pick<ProductSummary, 'available' | 'oneOfAKind'>) {
  if (product.available) return null;
  return product.oneOfAKind ? 'Sold' : 'Sold out';
}

const MISSING_TEXT = {
  variant: 'an option',
  photo: 'a photo',
  alt_text: 'alt text',
  shipping: 'shipping details',
} as const;

/** The admin's view of a product's state: published, or what it still needs to be. */
export function productState(product: {
  published: boolean;
  missing: (keyof typeof MISSING_TEXT)[];
}) {
  if (product.published) return 'Published';
  if (product.missing.length === 0) return 'Draft (ready to publish)';
  return `Draft (needs ${product.missing.map((m) => MISSING_TEXT[m]).join(', ')})`;
}
