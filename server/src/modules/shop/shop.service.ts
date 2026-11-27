/**
 * The shop catalog (milestone 12a, ADR 0019): ready-made products the owner manages from the
 * admin pages, and the public shop that lists them.
 *
 * - Until the shop opens (SHOP_OPEN), it answers only the admin: visitors get 404, so they
 *   never see things they can't buy yet. The admin also sees unpublished products there.
 * - A published product always has a variant, a photo, and alt text on every photo: a
 *   change that would break that is refused while it's published.
 * - Every stock change writes an inventory_movements row with it, in one transaction.
 * - Photos are processed like the gallery's (two WebP sizes, no metadata) and stored in R2;
 *   the site serves them itself (servePhoto), since the bucket is private.
 */
import type { PoolClient } from 'pg';
import type {
  AdminProduct,
  InventoryMovement,
  Product,
  ProductCategory,
  ProductInput,
  ProductPhoto,
  ProductSummary,
  ProductUpdate,
  StockChange,
  VariantInput,
} from '@shared/types/shop.ts';
import type { FileStorage } from '../../adapters/r2Storage.ts';
import { withTransaction } from '../../db/transaction.ts';
import { isForeignKeyViolation, isUniqueViolation } from '../../db/errors.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../../errors/index.js';
import { logger } from '../../lib/logger.js';
import { slugify } from '../../lib/slug.ts';
import { toLimitOffset, toPageMeta } from '../../lib/pagination.js';
import { detectType } from '../files/files.processing.ts';
import * as shopRepository from './shop.repository.ts';
import type { PhotoRecord, ProductRecord, VariantRecord } from './shop.repository.ts';
import { NotAPhotoError, photoKeys, processProductPhoto, PUBLIC_PHOTO_KEY } from './shop.photos.ts';
import { inStock, oneOfAKindProblem, priceRange, publishMissing } from './shop.rules.ts';

interface SessionUser {
  id: number;
  role: 'client' | 'admin';
}

/** A photo upload can be at most this big (phone photos are a few MB). */
export const PHOTO_MAX_BYTES = 20 * 1024 * 1024;
/** Photos per product. */
export const PHOTO_LIMIT = 10;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Products (and options) that were ever ordered stay in the order history: hide them instead. */
async function notOrdered<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isForeignKeyViolation(err, 'order_items_variant_id_fkey')) {
      throw new ConflictError(
        'This has been ordered, so it stays in the order history. Hide it instead.',
        {
          code: 'PRODUCT_HAS_ORDERS',
        },
      );
    }
    throw err;
  }
}

const productNotFound = () => new NotFoundError('Product not found', { code: 'PRODUCT_NOT_FOUND' });

// --- What the API returns ---

/** Photos are served by the site at /media/<key> (see servePhoto). */
function toPhoto(photo: PhotoRecord): ProductPhoto {
  return {
    id: photo.id,
    smallUrl: `/media/${photo.smallKey}`,
    largeUrl: `/media/${photo.largeKey}`,
    width: photo.width,
    height: photo.height,
    altText: photo.altText,
  };
}

function toSummary(
  product: ProductRecord,
  variants: VariantRecord[],
  photos: PhotoRecord[],
): ProductSummary {
  const range = priceRange(variants);
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    priceFromCents: range?.from ?? 0,
    priceToCents: range?.to ?? 0,
    available: inStock(variants),
    oneOfAKind: product.oneOfAKind,
    photo: photos[0] ? toPhoto(photos[0]) : null,
  };
}

function toProduct(
  product: ProductRecord,
  variants: VariantRecord[],
  photos: PhotoRecord[],
): Product {
  return {
    ...toSummary(product, variants, photos),
    description: product.description,
    materials: product.materials,
    dimensions: product.dimensions,
    variants: variants.map((v) => ({
      id: v.id,
      name: v.name,
      priceCents: v.priceCents,
      available: v.stock > 0,
    })),
    photos: photos.map(toPhoto),
  };
}

function toAdminProduct(
  product: ProductRecord,
  variants: VariantRecord[],
  photos: PhotoRecord[],
): AdminProduct {
  const { variants: _public, ...rest } = toProduct(product, variants, photos);
  return {
    ...rest,
    id: product.id,
    published: product.published,
    variants: variants.map((v) => ({
      id: v.id,
      name: v.name,
      priceCents: v.priceCents,
      available: v.stock > 0,
      stock: v.stock,
    })),
    stock: variants.reduce((sum, v) => sum + v.stock, 0),
    missing: publishMissing({ variants, photos }),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

/** Variants and photos for several products, grouped by product ID. */
async function partsFor(productIds: number[], client?: PoolClient) {
  const [variants, photos] = await Promise.all([
    shopRepository.variantsFor(productIds, client),
    shopRepository.photosFor(productIds, client),
  ]);
  const group = <T extends { productId: number }>(rows: T[]) => {
    const map = new Map<number, T[]>(productIds.map((id) => [id, []]));
    for (const row of rows) map.get(row.productId)!.push(row);
    return map;
  };
  return { variants: group(variants), photos: group(photos) };
}

// --- The public shop ---

/** Visitors see the shop only once it's open; the admin always does (a preview). */
function assertShopVisible(user: SessionUser | undefined, shopOpen: boolean) {
  if (!shopOpen && user?.role !== 'admin') {
    throw new NotFoundError('The shop is not open yet', { code: 'SHOP_CLOSED' });
  }
}

export async function listShopProducts(
  user: SessionUser | undefined,
  query: { category?: ProductCategory; page: number; pageSize: number },
  { shopOpen }: { shopOpen: boolean },
) {
  assertShopVisible(user, shopOpen);
  const { products, total } = await shopRepository.listProducts({
    publishedOnly: true,
    category: query.category,
    ...toLimitOffset(query),
  });
  const parts = await partsFor(products.map((p) => p.id));
  return {
    data: products.map((p) => toSummary(p, parts.variants.get(p.id)!, parts.photos.get(p.id)!)),
    meta: toPageMeta(query, total),
  };
}

/** A published product; the admin may also preview an unpublished one. */
export async function getShopProduct(
  user: SessionUser | undefined,
  slug: string,
  { shopOpen }: { shopOpen: boolean },
): Promise<Product> {
  assertShopVisible(user, shopOpen);
  const product = await shopRepository.findBySlug(slug);
  if (!product || (!product.published && user?.role !== 'admin')) throw productNotFound();
  const parts = await partsFor([product.id]);
  return toProduct(product, parts.variants.get(product.id)!, parts.photos.get(product.id)!);
}

/** A product photo's bytes, for the site to serve. Only product photo keys are readable. */
export async function servePhoto(
  key: string,
  { storage }: { storage?: FileStorage | null },
): Promise<{ body: Buffer; contentType: string }> {
  const notFound = () => new NotFoundError('Photo not found', { code: 'PHOTO_NOT_FOUND' });
  if (!storage || !PUBLIC_PHOTO_KEY.test(key)) throw notFound();
  const object = await storage.get(key);
  if (!object) throw notFound();
  return object;
}

// --- Admin: products ---

export async function listAdminProducts(query: {
  category?: ProductCategory;
  page: number;
  pageSize: number;
}) {
  const { products, total } = await shopRepository.listProducts({
    publishedOnly: false,
    category: query.category,
    ...toLimitOffset(query),
  });
  const parts = await partsFor(products.map((p) => p.id));
  return {
    data: products.map((p) =>
      toAdminProduct(p, parts.variants.get(p.id)!, parts.photos.get(p.id)!),
    ),
    meta: toPageMeta(query, total),
  };
}

async function loadAdminProduct(id: number, client?: PoolClient): Promise<AdminProduct> {
  const product = await shopRepository.findById(id, client);
  if (!product) throw productNotFound();
  const parts = await partsFor([id], client);
  return toAdminProduct(product, parts.variants.get(id)!, parts.photos.get(id)!);
}

export function getAdminProduct(id: number): Promise<AdminProduct> {
  return loadAdminProduct(id);
}

function slugFor(input: { slug?: string; name: string }): string {
  const slug = input.slug ?? slugify(input.name);
  if (!slug) {
    throw new ValidationError('Give the product a web address (slug): letters or numbers', {
      code: 'PRODUCT_SLUG_REQUIRED',
    });
  }
  return slug.slice(0, 120).replace(/-+$/, '');
}

/** Translates a unique violation on the slug into a 409. */
async function savingSlug<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isUniqueViolation(err, 'products_slug_key')) {
      throw new ConflictError('Another product already uses that web address (slug)', {
        code: 'PRODUCT_SLUG_TAKEN',
      });
    }
    throw err;
  }
}

/** A new product starts unpublished; variants and photos are added next. */
export async function createProduct(input: ProductInput): Promise<AdminProduct> {
  const record = await savingSlug(() =>
    shopRepository.insertProduct({
      ...input,
      slug: slugFor(input),
    }),
  );
  return loadAdminProduct(record.id);
}

/**
 * Locks the product, runs `change`, then checks the product still holds together: a
 * published one stays complete, and a one-of-a-kind one has one option with a stock of 0
 * or 1. Anything else rolls the change back.
 */
async function changeProduct(
  productId: number,
  change: (product: ProductRecord, tx: PoolClient) => Promise<void>,
): Promise<AdminProduct> {
  return withTransaction(async (tx) => {
    const product = await shopRepository.findById(productId, tx, { forUpdate: true });
    if (!product) throw productNotFound();
    await change(product, tx);
    const after = (await shopRepository.findById(productId, tx))!;
    const parts = await partsFor([productId], tx);
    const variants = parts.variants.get(productId)!;
    const photos = parts.photos.get(productId)!;
    const missing = publishMissing({ variants, photos });
    if (after.published && missing.length > 0) {
      throw new BusinessRuleError(
        product.published
          ? 'A published product needs an option, a photo, and alt text on every photo. Hide it first to remove these.'
          : 'Add an option, a photo, and alt text on every photo before publishing',
        { code: 'PRODUCT_INCOMPLETE', details: { missing } },
      );
    }
    const problem = oneOfAKindProblem(after.oneOfAKind, variants);
    if (problem) throw new BusinessRuleError(problem, { code: 'ONE_OF_A_KIND' });
    return toAdminProduct(after, variants, photos);
  });
}

export function updateProduct(id: number, changes: ProductUpdate): Promise<AdminProduct> {
  return savingSlug(() =>
    changeProduct(id, async (product, tx) => {
      const slug =
        changes.slug !== undefined
          ? slugFor({ slug: changes.slug, name: product.name })
          : undefined;
      await shopRepository.updateProduct(id, { ...changes, slug }, tx);
    }),
  );
}

/**
 * Deletes a product with its options, photos, and stock log, then its stored photos. (From
 * milestone 12b, a product that was ever ordered can't be deleted: hide it instead.)
 */
export async function deleteProduct(
  id: number,
  { storage }: { storage?: FileStorage | null },
): Promise<void> {
  const photos = await notOrdered(() =>
    withTransaction(async (tx) => {
      const product = await shopRepository.findById(id, tx, { forUpdate: true });
      if (!product) throw productNotFound();
      const list = await shopRepository.photosFor([id], tx);
      await shopRepository.deleteProduct(id, tx);
      return list;
    }),
  );
  await removeStored(storage, photos);
}

// --- Admin: variants and stock ---

function savingVariantName<T>(run: () => Promise<T>): Promise<T> {
  return run().catch((err) => {
    if (isUniqueViolation(err, 'product_variants_product_name_key')) {
      throw new ConflictError('This product already has an option with that name', {
        code: 'VARIANT_NAME_TAKEN',
      });
    }
    throw err;
  });
}

export function addVariant(
  user: SessionUser,
  productId: number,
  input: VariantInput,
): Promise<AdminProduct> {
  return savingVariantName(() =>
    changeProduct(productId, async (_product, tx) => {
      const variant = await shopRepository.insertVariant(productId, input, tx);
      await shopRepository.setStock(
        variant,
        { stock: input.stock, reason: 'restock', note: null, actorUserId: user.id },
        tx,
      );
    }),
  );
}

async function variantOrNotFound(variantId: number, tx?: PoolClient, forUpdate = false) {
  const variant = await shopRepository.findVariant(variantId, tx, { forUpdate });
  if (!variant) throw new NotFoundError('Option not found', { code: 'VARIANT_NOT_FOUND' });
  return variant;
}

export async function updateVariant(
  variantId: number,
  changes: { name?: string; priceCents?: number },
): Promise<AdminProduct> {
  const { productId } = await variantOrNotFound(variantId);
  return savingVariantName(() =>
    changeProduct(productId, async (_product, tx) => {
      await shopRepository.updateVariant(variantId, changes, tx);
    }),
  );
}

/** Sets an option's stock to a new count, logged as a restock or an adjustment. */
export async function setVariantStock(
  user: SessionUser,
  variantId: number,
  change: StockChange,
): Promise<AdminProduct> {
  const { productId } = await variantOrNotFound(variantId);
  return changeProduct(productId, async (_product, tx) => {
    const variant = await variantOrNotFound(variantId, tx, true);
    await shopRepository.setStock(
      variant,
      {
        stock: change.stock,
        reason: change.reason,
        note: change.note ?? null,
        actorUserId: user.id,
      },
      tx,
    );
  });
}

export async function deleteVariant(variantId: number): Promise<AdminProduct> {
  const { productId } = await variantOrNotFound(variantId);
  return notOrdered(() =>
    changeProduct(productId, async (_product, tx) => {
      await shopRepository.deleteVariant(variantId, tx);
    }),
  );
}

export async function listMovements(variantId: number): Promise<InventoryMovement[]> {
  await variantOrNotFound(variantId);
  const movements = await shopRepository.listMovements(variantId);
  return movements.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }));
}

// --- Admin: photos ---

function requireStorage(storage: FileStorage | null | undefined): FileStorage {
  if (!storage) {
    throw new ServiceUnavailableError("Photo uploads aren't available yet.", {
      code: 'FILES_UNAVAILABLE',
    });
  }
  return storage;
}

async function removeStored(storage: FileStorage | null | undefined, photos: PhotoRecord[]) {
  if (!storage || photos.length === 0) return;
  const keys = photos.flatMap((p) => [p.smallKey, p.largeKey]);
  await storage.remove(keys).catch((err) => {
    logger.warn({ err, keys }, 'could not remove product photos from storage');
  });
}

/**
 * Adds a photo (last in order). It's processed and stored first, then recorded under the
 * product's lock; if the record is refused (an 11th photo), the stored sizes are removed.
 */
export async function uploadPhoto(
  productId: number,
  data: Buffer,
  { storage }: { storage?: FileStorage | null },
): Promise<AdminProduct> {
  const store = requireStorage(storage);
  if (!(await shopRepository.findById(productId))) throw productNotFound();
  if (data.length > PHOTO_MAX_BYTES) {
    throw new ValidationError('A photo can be at most 20 MB', { code: 'FILE_TOO_LARGE' });
  }
  const type = detectType(data);
  if (!type || !PHOTO_TYPES.includes(type)) {
    throw new ValidationError('A photo must be a JPEG, PNG, or WebP image', {
      code: 'UNSUPPORTED_FILE_TYPE',
      details: { allowed: PHOTO_TYPES },
    });
  }
  let photo;
  try {
    photo = await processProductPhoto(data);
  } catch (err) {
    if (err instanceof NotAPhotoError) {
      throw new ValidationError("That file couldn't be read as an image", {
        code: 'NOT_AN_IMAGE',
      });
    }
    throw err;
  }

  const keys = photoKeys(productId, photo.hash);
  await store.put({ key: keys.small, body: photo.small, contentType: 'image/webp' });
  await store.put({ key: keys.large, body: photo.large, contentType: 'image/webp' });
  try {
    return await changeProduct(productId, async (_product, tx) => {
      const existing = await shopRepository.photosFor([productId], tx);
      if (existing.length >= PHOTO_LIMIT) {
        throw new BusinessRuleError(`A product can have at most ${PHOTO_LIMIT} photos`, {
          code: 'PHOTO_LIMIT',
        });
      }
      if (existing.some((p) => p.largeKey === keys.large)) {
        throw new ConflictError('This product already has that photo', {
          code: 'PHOTO_DUPLICATE',
        });
      }
      await shopRepository.insertPhoto(
        {
          productId,
          smallKey: keys.small,
          largeKey: keys.large,
          width: photo.width,
          height: photo.height,
        },
        tx,
      );
    });
  } catch (err) {
    // A duplicate's objects belong to the photo already there: keep them.
    if (!(err instanceof ConflictError)) {
      await removeStored(store, [{ smallKey: keys.small, largeKey: keys.large } as PhotoRecord]);
    }
    throw err;
  }
}

async function photoOrNotFound(photoId: number) {
  const photo = await shopRepository.findPhoto(photoId);
  if (!photo) throw new NotFoundError('Photo not found', { code: 'PHOTO_NOT_FOUND' });
  return photo;
}

/** The owner's description of a photo for screen readers (empty clears it). */
export async function setPhotoAltText(
  photoId: number,
  altText: string | null,
): Promise<AdminProduct> {
  const { productId } = await photoOrNotFound(photoId);
  return changeProduct(productId, async (_product, tx) => {
    await shopRepository.setAltText(photoId, altText, tx);
  });
}

/** Puts the photos in this order; the first is the product's cover. */
export function reorderPhotos(productId: number, photoIds: number[]): Promise<AdminProduct> {
  return changeProduct(productId, async (_product, tx) => {
    const current = (await shopRepository.photosFor([productId], tx)).map((p) => p.id);
    const same =
      current.length === photoIds.length &&
      new Set(photoIds).size === photoIds.length &&
      photoIds.every((id) => current.includes(id));
    if (!same) {
      throw new ValidationError("List each of the product's photos once", {
        code: 'PHOTO_ORDER_INVALID',
      });
    }
    await shopRepository.reorderPhotos(photoIds, tx);
  });
}

export async function deletePhoto(
  photoId: number,
  { storage }: { storage?: FileStorage | null },
): Promise<AdminProduct> {
  const photo = await photoOrNotFound(photoId);
  const product = await changeProduct(photo.productId, async (_product, tx) => {
    await shopRepository.deletePhoto(photoId, tx);
  });
  await removeStored(storage, [photo]);
  return product;
}

// --- For orders (milestone 12b): pricing a cart, and holding and releasing stock ---

export interface CartVariant {
  variantId: number;
  productId: number;
  productSlug: string;
  productName: string;
  variantName: string;
  priceCents: number;
  stock: number;
  /** Published (and so for sale). */
  forSale: boolean;
  photo: ProductPhoto | null;
}

/** The current price, stock, and names of these variants (unknown IDs are left out). */
export async function cartVariants(variantIds: number[]): Promise<CartVariant[]> {
  const variants = await shopRepository.findVariants(variantIds);
  const productIds = [...new Set(variants.map((v) => v.productId))];
  const [products, photos] = await Promise.all([
    shopRepository.findProducts(productIds),
    shopRepository.photosFor(productIds),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  return variants.map((v) => {
    const product = productById.get(v.productId)!;
    const cover = photos.find((p) => p.productId === v.productId);
    return {
      variantId: v.id,
      productId: v.productId,
      productSlug: product.slug,
      productName: product.name,
      variantName: v.name,
      priceCents: v.priceCents,
      stock: v.stock,
      forSale: product.published,
      photo: cover ? toPhoto(cover) : null,
    };
  });
}

/**
 * Holds stock for an order inside the caller's transaction: locks the variants (in ID
 * order), checks each is for sale with enough stock, and takes the quantity off with a
 * `reservation` log row. Returns the names and prices as they are now, for the order's
 * lines. Two checkouts for the last piece queue on the lock; the second finds none left.
 */
export async function holdStock(
  lines: { variantId: number; quantity: number }[],
  orderId: number,
  tx: PoolClient,
): Promise<{ variantId: number; productName: string; variantName: string; priceCents: number }[]> {
  const locked = await shopRepository.lockVariants(
    lines.map((l) => l.variantId),
    tx,
  );
  const byId = new Map(locked.map((v) => [v.id, v]));
  const products = new Map(
    (await shopRepository.findProducts([...new Set(locked.map((v) => v.productId))], tx)).map(
      (p) => [p.id, p],
    ),
  );
  const short: { variantId: number; available: number }[] = [];
  for (const line of lines) {
    const variant = byId.get(line.variantId);
    const product = variant && products.get(variant.productId);
    if (!variant || !product?.published) {
      short.push({ variantId: line.variantId, available: 0 });
    } else if (variant.stock < line.quantity) {
      short.push({ variantId: line.variantId, available: variant.stock });
    }
  }
  if (short.length > 0) {
    throw new ConflictError('Some items in your cart are no longer available in that quantity', {
      code: 'OUT_OF_STOCK',
      details: { items: short },
    });
  }
  for (const line of lines) {
    const variant = byId.get(line.variantId)!;
    await shopRepository.setStock(
      variant,
      {
        stock: variant.stock - line.quantity,
        reason: 'reservation',
        note: null,
        actorUserId: null,
        orderId,
      },
      tx,
    );
  }
  return lines.map((line) => {
    const variant = byId.get(line.variantId)!;
    return {
      variantId: variant.id,
      productName: products.get(variant.productId)!.name,
      variantName: variant.name,
      priceCents: variant.priceCents,
    };
  });
}

/**
 * Puts an order's items back in stock, in the caller's transaction: `release` when an
 * unpaid order ends, `return` when a refunded order's items go back on sale.
 */
export async function putBackStock(
  lines: { variantId: number; quantity: number }[],
  orderId: number,
  reason: 'release' | 'return',
  tx: PoolClient,
): Promise<void> {
  const locked = await shopRepository.lockVariants(
    lines.map((l) => l.variantId),
    tx,
  );
  const byId = new Map(locked.map((v) => [v.id, v]));
  for (const line of lines) {
    const variant = byId.get(line.variantId)!;
    await shopRepository.setStock(
      variant,
      { stock: variant.stock + line.quantity, reason, note: null, actorUserId: null, orderId },
      tx,
    );
  }
}
