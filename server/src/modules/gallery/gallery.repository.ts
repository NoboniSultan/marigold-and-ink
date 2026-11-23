/**
 * SQL for artworks, tags, and artwork_tags. Every query is parameterized, and every
 * function accepts an optional `client` so the service can group calls in a transaction.
 */
import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

type Db = Pool | PoolClient;

const COLUMNS = `a.id, a.slug, a.title, a.description, a.medium, a.category, a.year, a.credit,
  a.alt_text, a.image_key, a.thumb_path, a.thumb_width, a.thumb_height, a.large_path,
  a.large_width, a.large_height, a.is_published, a.is_monochrome, a.sort_order, a.content_hash,
  a.created_at, a.updated_at`;

// Each artwork's tags as a JSON array, so a list needs one query instead of one per row.
const TAGS_JSON = `COALESCE((
    SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'slug', t.slug) ORDER BY t.name)
      FROM artwork_tags at JOIN tags t ON t.id = at.tag_id
     WHERE at.artwork_id = a.id
  ), '[]'::json) AS tags`;

export interface TagRow {
  id: number;
  name: string;
  slug: string;
}

export interface ArtworkRecord {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  medium: string | null;
  category: string;
  year: number | null;
  credit: string | null;
  altText: string | null;
  imageKey: string;
  thumbPath: string;
  thumbWidth: number;
  thumbHeight: number;
  largePath: string;
  largeWidth: number;
  largeHeight: number;
  isPublished: boolean;
  isMonochrome: boolean;
  sortOrder: number;
  contentHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags: TagRow[];
}

/** The writable columns, in camelCase. */
export type ArtworkFields = Omit<ArtworkRecord, 'id' | 'createdAt' | 'updatedAt' | 'tags'>;

// Column name for each writable field. Doubles as the allow-list for updates: only these
// keys can ever reach the SQL, so a field name is never taken from user input.
const FIELD_COLUMNS: Record<keyof ArtworkFields, string> = {
  slug: 'slug',
  title: 'title',
  description: 'description',
  medium: 'medium',
  category: 'category',
  year: 'year',
  credit: 'credit',
  altText: 'alt_text',
  imageKey: 'image_key',
  thumbPath: 'thumb_path',
  thumbWidth: 'thumb_width',
  thumbHeight: 'thumb_height',
  largePath: 'large_path',
  largeWidth: 'large_width',
  largeHeight: 'large_height',
  isPublished: 'is_published',
  isMonochrome: 'is_monochrome',
  sortOrder: 'sort_order',
  contentHash: 'content_hash',
};

type Row = Record<string, unknown>;

function toArtwork(row: Row): ArtworkRecord {
  return {
    id: row.id as number,
    slug: row.slug as string,
    title: row.title as string,
    description: row.description as string | null,
    medium: row.medium as string | null,
    category: row.category as string,
    year: row.year as number | null,
    credit: row.credit as string | null,
    altText: row.alt_text as string | null,
    imageKey: row.image_key as string,
    thumbPath: row.thumb_path as string,
    thumbWidth: row.thumb_width as number,
    thumbHeight: row.thumb_height as number,
    largePath: row.large_path as string,
    largeWidth: row.large_width as number,
    largeHeight: row.large_height as number,
    isPublished: row.is_published as boolean,
    isMonochrome: row.is_monochrome as boolean,
    sortOrder: row.sort_order as number,
    contentHash: row.content_hash as string | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    tags: (row.tags as TagRow[] | undefined) ?? [],
  };
}

export interface ListFilters {
  /** 'published' for the public gallery; admins may also ask for drafts or everything. */
  status: 'published' | 'draft' | 'all';
  category?: string | undefined;
  /** Tag slug. */
  tag?: string | undefined;
  /** Search text, in web-search syntax: words, "quoted phrases", -excluded. */
  q?: string | undefined;
  limit: number;
  offset: number;
}

// The list's filters, shared by the page query and the count below. Parameters:
// $1 status, $2 category, $3 tag slug, $4 search text.
// websearch_to_tsquery never throws on user input (unlike to_tsquery), so search text
// like `"starry night" -sketch` is safe to pass straight through as a parameter.
const LIST_WHERE = `
  WHERE ($1::text = 'all' OR a.is_published = ($1::text = 'published'))
    AND ($2::text IS NULL OR a.category = $2)
    AND ($3::text IS NULL OR EXISTS (
          SELECT 1 FROM artwork_tags at JOIN tags t ON t.id = at.tag_id
           WHERE at.artwork_id = a.id AND t.slug = $3))
    AND ($4::text IS NULL OR a.search_vector @@ websearch_to_tsquery('english_unaccent', $4))`;

export async function listArtworks(
  { status, category, tag, q, limit, offset }: ListFilters,
  client: Db = pool,
): Promise<{ artworks: ArtworkRecord[]; total: number }> {
  const filters = [status, category ?? null, tag ?? null, q ?? null];
  // With a search, the best matches come first. Otherwise black-and-white pieces first (the
  // owner's choice), each group in the owner's gallery order.
  const { rows } = await client.query(
    `SELECT ${COLUMNS}, ${TAGS_JSON}, count(*) OVER () AS total
       FROM artworks a
      ${LIST_WHERE}
      ORDER BY CASE WHEN $4::text IS NULL THEN 0
                    ELSE ts_rank(a.search_vector, websearch_to_tsquery('english_unaccent', $4)) END DESC,
               a.is_monochrome DESC, a.sort_order, a.id
      LIMIT $5 OFFSET $6`,
    [...filters, limit, offset],
  );
  // count(*) OVER () rides along on each row. A page past the end has no rows to carry it,
  // so count separately; an empty first page really does mean there are none.
  let total = rows.length > 0 ? Number(rows[0].total) : 0;
  if (rows.length === 0 && offset > 0) {
    const counted = await client.query(
      `SELECT count(*)::int AS total FROM artworks a ${LIST_WHERE}`,
      filters,
    );
    total = counted.rows[0].total;
  }
  return { artworks: rows.map(toArtwork), total };
}

export async function findBySlug(slug: string, client: Db = pool): Promise<ArtworkRecord | null> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS}, ${TAGS_JSON} FROM artworks a WHERE a.slug = $1`,
    [slug],
  );
  return rows[0] ? toArtwork(rows[0]) : null;
}

export async function findById(
  id: number,
  client: Db = pool,
  { forUpdate = false } = {},
): Promise<ArtworkRecord | null> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS}, ${TAGS_JSON} FROM artworks a WHERE a.id = $1${forUpdate ? ' FOR UPDATE OF a' : ''}`,
    [id],
  );
  return rows[0] ? toArtwork(rows[0]) : null;
}

/** Published categories with counts, for the gallery's filter. */
export async function listPublishedCategories(
  client: Db = pool,
): Promise<{ category: string; count: number }[]> {
  const { rows } = await client.query(
    `SELECT category, count(*)::int AS count
       FROM artworks WHERE is_published
      GROUP BY category ORDER BY category`,
  );
  return rows;
}

export async function insertArtwork(
  fields: ArtworkFields,
  client: Db = pool,
): Promise<{ id: number }> {
  const keys = Object.keys(FIELD_COLUMNS) as (keyof ArtworkFields)[];
  const { rows } = await client.query(
    `INSERT INTO artworks (${keys.map((k) => FIELD_COLUMNS[k]).join(', ')})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING id`,
    keys.map((k) => fields[k]),
  );
  return { id: rows[0].id };
}

export async function updateArtwork(
  id: number,
  changes: Partial<ArtworkFields>,
  client: Db = pool,
): Promise<void> {
  const keys = (Object.keys(changes) as (keyof ArtworkFields)[]).filter(
    (key) => key in FIELD_COLUMNS && changes[key] !== undefined,
  );
  if (keys.length === 0) return;
  await client.query(
    `UPDATE artworks SET ${keys.map((k, i) => `${FIELD_COLUMNS[k]} = $${i + 2}`).join(', ')}
      WHERE id = $1`,
    [id, ...keys.map((k) => changes[k])],
  );
}

export async function deleteArtwork(id: number, client: Db = pool): Promise<boolean> {
  const { rowCount } = await client.query('DELETE FROM artworks WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

/** What the content seed needs to decide insert / update / skip / delete. */
export async function listContentState(
  client: Db = pool,
): Promise<{ id: number; imageKey: string; contentHash: string | null }[]> {
  const { rows } = await client.query('SELECT id, image_key, content_hash FROM artworks');
  return rows.map((r) => ({ id: r.id, imageKey: r.image_key, contentHash: r.content_hash }));
}

// --- Tags ---

/** Tags with how many artworks use them; `publishedOnly` counts and lists only public use. */
export async function listTags(
  { publishedOnly }: { publishedOnly: boolean },
  client: Db = pool,
): Promise<(TagRow & { count: number })[]> {
  const { rows } = await client.query(
    `SELECT t.id, t.name, t.slug, count(a.id)::int AS count
       FROM tags t
       LEFT JOIN artwork_tags at ON at.tag_id = t.id
       LEFT JOIN artworks a ON a.id = at.artwork_id AND (NOT $1::boolean OR a.is_published)
      GROUP BY t.id
     HAVING NOT $1::boolean OR count(a.id) > 0
      ORDER BY t.name`,
    [publishedOnly],
  );
  return rows;
}

export async function insertTag(
  { name, slug }: { name: string; slug: string },
  client: Db = pool,
): Promise<TagRow> {
  const { rows } = await client.query(
    'INSERT INTO tags (name, slug) VALUES ($1, $2) RETURNING id, name, slug',
    [name, slug],
  );
  return rows[0];
}

export async function updateTag(
  id: number,
  { name, slug }: { name?: string | undefined; slug?: string | undefined },
  client: Db = pool,
): Promise<TagRow | null> {
  const { rows } = await client.query(
    `UPDATE tags SET name = COALESCE($2, name), slug = COALESCE($3, slug)
      WHERE id = $1 RETURNING id, name, slug`,
    [id, name ?? null, slug ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteTag(id: number, client: Db = pool): Promise<boolean> {
  const { rowCount } = await client.query('DELETE FROM tags WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Returns the IDs of tags with these slugs, creating any that don't exist yet.
 * Existing tags keep their current name (an admin may have renamed them).
 */
export async function ensureTags(
  tags: { name: string; slug: string }[],
  client: Db = pool,
): Promise<number[]> {
  if (tags.length === 0) return [];
  const { rows } = await client.query(
    `WITH input AS (
       SELECT * FROM unnest($1::text[], $2::text[]) AS i(name, slug)
     ), inserted AS (
       INSERT INTO tags (name, slug) SELECT name, slug FROM input
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, slug
     )
     SELECT id, slug FROM inserted
     UNION ALL
     SELECT t.id, t.slug FROM tags t JOIN input i ON i.slug = t.slug`,
    [tags.map((t) => t.name), tags.map((t) => t.slug)],
  );
  // A tag inserted by this statement isn't visible to the second SELECT (same snapshot),
  // so each slug appears exactly once across the two halves.
  const idBySlug = new Map(rows.map((r) => [r.slug as string, r.id as number]));
  return tags.map((t) => idBySlug.get(t.slug)!);
}

/** Replaces an artwork's tags with exactly `tagIds`. */
export async function setArtworkTags(
  artworkId: number,
  tagIds: number[],
  client: Db = pool,
): Promise<void> {
  await client.query('DELETE FROM artwork_tags WHERE artwork_id = $1', [artworkId]);
  if (tagIds.length === 0) return;
  await client.query(
    `INSERT INTO artwork_tags (artwork_id, tag_id)
     SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`,
    [artworkId, tagIds],
  );
}
