/** The shop catalog (milestone 12a, ADR 0019). Money is integer cents (USD). */

/** The four categories from the proposal (section 4). */
export type ProductCategory = 'jewelry' | 'cards' | 'stickers' | 'upcycled';

export interface ProductPhoto {
  id: number;
  /** About 600 px wide, for lists and thumbnails. */
  smallUrl: string;
  /** At most 1600 px on the long edge. */
  largeUrl: string;
  width: number;
  height: number;
  /** Null only while the owner hasn't written it (the product can't be published then). */
  altText: string | null;
}

/** What a customer chooses: each has its own price. */
export interface ProductVariant {
  id: number;
  name: string;
  priceCents: number;
  available: boolean;
}

/** A product card in the shop list. */
export interface ProductSummary {
  slug: string;
  name: string;
  category: ProductCategory;
  /** The lowest and highest variant prices (equal when there's one price). */
  priceFromCents: number;
  priceToCents: number;
  /** Is anything in stock? */
  available: boolean;
  oneOfAKind: boolean;
  /** The first photo, or null. */
  photo: ProductPhoto | null;
}

/** A product's page. */
export interface Product extends ProductSummary {
  description: string;
  materials: string | null;
  dimensions: string | null;
  variants: ProductVariant[];
  photos: ProductPhoto[];
}

export interface ShopStatus {
  /** False until the owner opens the shop (SHOP_OPEN); until then only the admin sees it. */
  open: boolean;
}

// --- Admin ---

export interface AdminVariant extends ProductVariant {
  stock: number;
}

export interface AdminProduct extends Omit<Product, 'variants'> {
  id: number;
  published: boolean;
  variants: AdminVariant[];
  /** Total stock across the variants. */
  stock: number;
  /** What still stops it from being published (empty when it can be). */
  missing: ('variant' | 'photo' | 'alt_text')[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name: string;
  /** From the name when left out. */
  slug?: string;
  category: ProductCategory;
  description: string;
  materials: string | null;
  dimensions: string | null;
  oneOfAKind: boolean;
}

export type ProductUpdate = Partial<ProductInput> & { published?: boolean };

export interface VariantInput {
  name: string;
  priceCents: number;
  /** The starting stock. */
  stock: number;
}

export interface StockChange {
  /** The new count. */
  stock: number;
  reason: 'restock' | 'adjustment';
  note?: string | null;
}

export interface InventoryMovement {
  change: number;
  stockAfter: number;
  reason: 'restock' | 'adjustment' | 'reservation' | 'release' | 'return';
  /** The order a hold, release, or return belongs to. */
  orderId: number | null;
  note: string | null;
  createdAt: string;
}
