/**
 * SQL for the shop catalog (milestone 12a): products, variants, photos, and the inventory
 * log. Every function accepts an optional `client` so the service can group calls in a
 * transaction.
 */
import type { Pool, PoolClient } from 'pg';
import type { ProductCategory } from '@shared/types/shop.ts';
import { pool } from '../../db/pool.js';

type Db = Pool | PoolClient;
type Row = Record<string, unknown>;

export interface ProductRecord {
  id: number;
  slug: string;
  name: string;
  category: ProductCategory;
  description: string;
  materials: string | null;
  dimensions: string | null;
  oneOfAKind: boolean;
  published: boolean;
  packingTypeId: number | null;
  pickupOnly: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PackingTypeRecord {
  id: number;
  name: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightOz: number;
}

export interface VariantRecord {
  id: number;
  productId: number;
  name: string;
  priceCents: number;
  stock: number;
  position: number;
  weightOz: number | null;
}

export interface PhotoRecord {
  id: number;
  productId: number;
  smallKey: string;
  largeKey: string;
  width: number;
  height: number;
  altText: string | null;
  position: number;
}

export interface MovementRecord {
  change: number;
  stockAfter: number;
  reason: 'restock' | 'adjustment' | 'reservation' | 'release' | 'return';
  orderId: number | null;
  note: string | null;
  createdAt: Date;
}

const PRODUCT_COLUMNS = `id, slug, name, category, description, materials, dimensions,
  one_of_a_kind, published, packing_type_id, pickup_only, created_at, updated_at`;
const VARIANT_COLUMNS = 'id, product_id, name, price_cents, stock, position, weight_oz';
const PACKING_COLUMNS = 'id, name, length_in, width_in, height_in, weight_oz';
const PHOTO_COLUMNS = 'id, product_id, small_key, large_key, width, height, alt_text, position';

function toProduct(row: Row): ProductRecord {
  return {
    id: Number(row.id),
    slug: row.slug as string,
    name: row.name as string,
    category: row.category as ProductCategory,
    description: row.description as string,
    materials: row.materials as string | null,
    dimensions: row.dimensions as string | null,
    oneOfAKind: row.one_of_a_kind as boolean,
    published: row.published as boolean,
    packingTypeId: row.packing_type_id === null ? null : Number(row.packing_type_id),
    pickupOnly: row.pickup_only as boolean,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toVariant(row: Row): VariantRecord {
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    name: row.name as string,
    priceCents: Number(row.price_cents),
    stock: Number(row.stock),
    position: Number(row.position),
    // numeric columns arrive as text
    weightOz: row.weight_oz === null ? null : Number(row.weight_oz),
  };
}

function toPacking(row: Row): PackingTypeRecord {
  return {
    id: Number(row.id),
    name: row.name as string,
    lengthIn: Number(row.length_in),
    widthIn: Number(row.width_in),
    heightIn: Number(row.height_in),
    weightOz: Number(row.weight_oz),
  };
}

function toPhoto(row: Row): PhotoRecord {
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    smallKey: row.small_key as string,
    largeKey: row.large_key as string,
    width: Number(row.width),
    height: Number(row.height),
    altText: row.alt_text as string | null,
    position: Number(row.position),
  };
}

// --- Products ---

/** Products, newest first; `publishedOnly` for the shop, a category to filter. */
export async function listProducts(
  {
    publishedOnly,
    category,
    limit,
    offset,
  }: { publishedOnly: boolean; category?: ProductCategory; limit: number; offset: number },
  client: Db = pool,
): Promise<{ products: ProductRecord[]; total: number }> {
  const where = `WHERE ($1::boolean IS FALSE OR published) AND ($2::text IS NULL OR category = $2)`;
  const params = [publishedOnly, category ?? null];
  const [{ rows }, count] = await Promise.all([
    client.query(
      `SELECT ${PRODUCT_COLUMNS} FROM products ${where}
        ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
      [...params, limit, offset],
    ),
    client.query(`SELECT count(*)::int AS total FROM products ${where}`, params),
  ]);
  return { products: rows.map(toProduct), total: count.rows[0].total };
}

export async function findBySlug(slug: string, client: Db = pool): Promise<ProductRecord | null> {
  const { rows } = await client.query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE slug = $1`, [
    slug,
  ]);
  return rows[0] ? toProduct(rows[0]) : null;
}

export async function findProducts(ids: number[], client: Db = pool): Promise<ProductRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await client.query(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  return rows.map(toProduct);
}

export async function findById(
  id: number,
  client: Db = pool,
  { forUpdate = false } = {},
): Promise<ProductRecord | null> {
  const { rows } = await client.query(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ? toProduct(rows[0]) : null;
}

export interface ProductFields {
  slug: string;
  name: string;
  category: ProductCategory;
  description: string;
  materials: string | null;
  dimensions: string | null;
  oneOfAKind: boolean;
  packingTypeId?: number | null;
  pickupOnly?: boolean;
}

export async function insertProduct(fields: ProductFields, client: Db = pool) {
  const { rows } = await client.query(
    `INSERT INTO products (slug, name, category, description, materials, dimensions, one_of_a_kind,
                           packing_type_id, pickup_only)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${PRODUCT_COLUMNS}`,
    [
      fields.slug,
      fields.name,
      fields.category,
      fields.description,
      fields.materials,
      fields.dimensions,
      fields.oneOfAKind,
      fields.packingTypeId ?? null,
      fields.pickupOnly ?? false,
    ],
  );
  return toProduct(rows[0]);
}

const PRODUCT_UPDATABLE = {
  slug: 'slug',
  name: 'name',
  category: 'category',
  description: 'description',
  materials: 'materials',
  dimensions: 'dimensions',
  oneOfAKind: 'one_of_a_kind',
  published: 'published',
  packingTypeId: 'packing_type_id',
  pickupOnly: 'pickup_only',
} as const;

export async function updateProduct(
  id: number,
  changes: Partial<ProductFields & { published: boolean }>,
  client: Db = pool,
): Promise<ProductRecord> {
  const entries = Object.entries(changes).filter(([, v]) => v !== undefined) as [
    keyof typeof PRODUCT_UPDATABLE,
    unknown,
  ][];
  if (entries.length === 0) return (await findById(id, client))!;
  const sets = entries.map(([key], i) => `${PRODUCT_UPDATABLE[key]} = $${i + 2}`);
  const { rows } = await client.query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $1 RETURNING ${PRODUCT_COLUMNS}`,
    [id, ...entries.map(([, v]) => v)],
  );
  return toProduct(rows[0]);
}

export async function deleteProduct(id: number, client: Db = pool): Promise<void> {
  await client.query('DELETE FROM products WHERE id = $1', [id]);
}

// --- Variants ---

/** Variants of these products, in their order. */
export async function variantsFor(
  productIds: number[],
  client: Db = pool,
): Promise<VariantRecord[]> {
  if (productIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT ${VARIANT_COLUMNS} FROM product_variants
      WHERE product_id = ANY($1::bigint[]) ORDER BY position, id`,
    [productIds],
  );
  return rows.map(toVariant);
}

export async function findVariants(ids: number[], client: Db = pool): Promise<VariantRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await client.query(
    `SELECT ${VARIANT_COLUMNS} FROM product_variants WHERE id = ANY($1::bigint[]) ORDER BY id`,
    [ids],
  );
  return rows.map(toVariant);
}

export async function findVariant(
  id: number,
  client: Db = pool,
  { forUpdate = false } = {},
): Promise<VariantRecord | null> {
  const { rows } = await client.query(
    `SELECT ${VARIANT_COLUMNS} FROM product_variants WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ? toVariant(rows[0]) : null;
}

/** A new variant, last in order, with no stock (stock is set through setStock). */
export async function insertVariant(
  productId: number,
  {
    name,
    priceCents,
    weightOz = null,
  }: { name: string; priceCents: number; weightOz?: number | null },
  client: Db = pool,
): Promise<VariantRecord> {
  const { rows } = await client.query(
    `INSERT INTO product_variants (product_id, name, price_cents, weight_oz, position)
     VALUES ($1, $2, $3, $4,
       (SELECT COALESCE(max(position) + 1, 0) FROM product_variants WHERE product_id = $1))
     RETURNING ${VARIANT_COLUMNS}`,
    [productId, name, priceCents, weightOz],
  );
  return toVariant(rows[0]);
}

export async function updateVariant(
  id: number,
  changes: { name?: string; priceCents?: number; weightOz?: number | null },
  client: Db = pool,
): Promise<VariantRecord> {
  const { rows } = await client.query(
    `UPDATE product_variants
        SET name = COALESCE($2, name), price_cents = COALESCE($3, price_cents),
            weight_oz = CASE WHEN $4::boolean THEN $5::numeric ELSE weight_oz END
      WHERE id = $1
      RETURNING ${VARIANT_COLUMNS}`,
    [
      id,
      changes.name ?? null,
      changes.priceCents ?? null,
      changes.weightOz !== undefined,
      changes.weightOz ?? null,
    ],
  );
  return toVariant(rows[0]);
}

export async function deleteVariant(id: number, client: Db = pool): Promise<void> {
  await client.query('DELETE FROM product_variants WHERE id = $1', [id]);
}

/**
 * Sets a variant's stock and logs the change, in the caller's transaction (the variant row
 * is locked by the caller). Does nothing when the count doesn't change. Holds, releases, and
 * returns name their order; the owner's restocks and adjustments name who made them.
 */
export async function setStock(
  variant: VariantRecord,
  {
    stock,
    reason,
    note,
    actorUserId,
    orderId = null,
  }: {
    stock: number;
    reason: MovementRecord['reason'];
    note: string | null;
    actorUserId: number | null;
    orderId?: number | null;
  },
  client: Db,
): Promise<void> {
  const change = stock - variant.stock;
  if (change === 0) return;
  await client.query('UPDATE product_variants SET stock = $2 WHERE id = $1', [variant.id, stock]);
  await client.query(
    `INSERT INTO inventory_movements (variant_id, change, stock_after, reason, note, actor_user_id,
                                      order_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [variant.id, change, stock, reason, note, actorUserId, orderId],
  );
}

/** Locks these variants (in ID order, so two checkouts can't deadlock) and returns them. */
export async function lockVariants(ids: number[], client: Db): Promise<VariantRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await client.query(
    `SELECT ${VARIANT_COLUMNS} FROM product_variants
      WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
    [ids],
  );
  return rows.map(toVariant);
}

/** A variant's stock changes, newest first. */
export async function listMovements(variantId: number, client: Db = pool) {
  const { rows } = await client.query(
    `SELECT change, stock_after, reason, order_id, note, created_at FROM inventory_movements
      WHERE variant_id = $1 ORDER BY id DESC LIMIT 100`,
    [variantId],
  );
  return rows.map((row): MovementRecord => ({
    change: Number(row.change),
    stockAfter: Number(row.stock_after),
    reason: row.reason as MovementRecord['reason'],
    orderId: row.order_id === null ? null : Number(row.order_id),
    note: row.note as string | null,
    createdAt: row.created_at as Date,
  }));
}

// --- Photos ---

/** Photos of these products, in their order. */
export async function photosFor(productIds: number[], client: Db = pool): Promise<PhotoRecord[]> {
  if (productIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT ${PHOTO_COLUMNS} FROM product_photos
      WHERE product_id = ANY($1::bigint[]) ORDER BY position, id`,
    [productIds],
  );
  return rows.map(toPhoto);
}

export async function findPhoto(id: number, client: Db = pool): Promise<PhotoRecord | null> {
  const { rows } = await client.query(`SELECT ${PHOTO_COLUMNS} FROM product_photos WHERE id = $1`, [
    id,
  ]);
  return rows[0] ? toPhoto(rows[0]) : null;
}

/** Adds a photo last in order. */
export async function insertPhoto(
  photo: Omit<PhotoRecord, 'id' | 'position' | 'altText'>,
  client: Db = pool,
): Promise<PhotoRecord> {
  const { rows } = await client.query(
    `INSERT INTO product_photos (product_id, small_key, large_key, width, height, position)
     VALUES ($1, $2, $3, $4, $5,
       (SELECT COALESCE(max(position) + 1, 0) FROM product_photos WHERE product_id = $1))
     RETURNING ${PHOTO_COLUMNS}`,
    [photo.productId, photo.smallKey, photo.largeKey, photo.width, photo.height],
  );
  return toPhoto(rows[0]);
}

export async function setAltText(id: number, altText: string | null, client: Db = pool) {
  await client.query('UPDATE product_photos SET alt_text = $2 WHERE id = $1', [id, altText]);
}

/** Puts a product's photos in the given order (IDs must be exactly its photos). */
export async function reorderPhotos(photoIds: number[], client: Db = pool): Promise<void> {
  await client.query(
    `UPDATE product_photos p SET position = o.position - 1
       FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, position)
      WHERE p.id = o.id`,
    [photoIds],
  );
}

export async function deletePhoto(id: number, client: Db = pool): Promise<void> {
  await client.query('DELETE FROM product_photos WHERE id = $1', [id]);
}

// --- Packing types (milestone 12c) ---

export async function listPackingTypes(client: Db = pool): Promise<PackingTypeRecord[]> {
  const { rows } = await client.query(`SELECT ${PACKING_COLUMNS} FROM packing_types ORDER BY name`);
  return rows.map(toPacking);
}

export async function findPackingTypes(
  ids: number[],
  client: Db = pool,
): Promise<PackingTypeRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await client.query(
    `SELECT ${PACKING_COLUMNS} FROM packing_types WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  return rows.map(toPacking);
}

export async function insertPackingType(
  t: Omit<PackingTypeRecord, 'id'>,
  client: Db = pool,
): Promise<PackingTypeRecord> {
  const { rows } = await client.query(
    `INSERT INTO packing_types (name, length_in, width_in, height_in, weight_oz)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${PACKING_COLUMNS}`,
    [t.name, t.lengthIn, t.widthIn, t.heightIn, t.weightOz],
  );
  return toPacking(rows[0]);
}

export async function updatePackingType(
  id: number,
  t: Omit<PackingTypeRecord, 'id'>,
  client: Db = pool,
): Promise<PackingTypeRecord | null> {
  const { rows } = await client.query(
    `UPDATE packing_types SET name = $2, length_in = $3, width_in = $4, height_in = $5,
            weight_oz = $6
      WHERE id = $1 RETURNING ${PACKING_COLUMNS}`,
    [id, t.name, t.lengthIn, t.widthIn, t.heightIn, t.weightOz],
  );
  return rows[0] ? toPacking(rows[0]) : null;
}

export async function deletePackingType(id: number, client: Db = pool): Promise<boolean> {
  const { rowCount } = await client.query('DELETE FROM packing_types WHERE id = $1', [id]);
  return rowCount === 1;
}
