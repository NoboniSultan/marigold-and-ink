/**
 * Gallery business rules: what the public may see, admin edits, and syncing
 * content/artworks.json into the database.
 *
 * Source of truth (decision A in milestone 5): content/artworks.json owns the artworks it
 * lists. Each such row stores a hash of its file entry, and `syncContent` rewrites a row
 * only when that hash changes. So editing the file always wins, while an admin edit made
 * through the API sticks until the owner next edits that artwork in the file. Deleting a
 * file-owned artwork must happen in the file (the API refuses), or the seed would bring it
 * back on the next start.
 */
import type { AdminArtwork, Artwork, CategoryCount, Tag } from '@shared/types/artwork.ts';
import type { PageMeta } from '@shared/types/api.ts';
import { withTransaction } from '../../db/transaction.ts';
import { isUniqueViolation } from '../../db/errors.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../errors/index.js';
import { toLimitOffset, toPageMeta } from '../../lib/pagination.js';
import { slugify } from '../../lib/slug.ts';
import { loadManifest } from '../../lib/mediaManifest.ts';
import { MEDIA_DIR } from '../../config/paths.ts';
import * as galleryRepository from './gallery.repository.ts';
import type { ArtworkFields, ArtworkRecord } from './gallery.repository.ts';
import { ContentError, type DesiredArtwork } from './gallery.content.ts';
import type {
  AdminListArtworksQuery,
  CreateArtworkInput,
  CreateTagInput,
  ListArtworksQuery,
  UpdateArtworkInput,
  UpdateTagInput,
} from './gallery.validation.ts';

// --- Mapping database records to the shared API types ---

function imageOf(record: ArtworkRecord) {
  return {
    thumb: { src: record.thumbPath, width: record.thumbWidth, height: record.thumbHeight },
    large: { src: record.largePath, width: record.largeWidth, height: record.largeHeight },
    monochrome: record.isMonochrome,
  };
}

/** The public shape. `satisfies`-style return typing makes the compiler hold us to it. */
export function toPublicArtwork(record: ArtworkRecord): Artwork {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    description: record.description,
    medium: record.medium,
    category: record.category,
    year: record.year,
    credit: record.credit,
    // Published rows always have alt text (a database check); the title is a type-level fallback.
    image: { ...imageOf(record), alt: record.altText ?? record.title },
    tags: record.tags,
  };
}

export function toAdminArtwork(record: ArtworkRecord): AdminArtwork {
  return {
    ...toPublicArtwork(record),
    image: { ...imageOf(record), alt: record.altText },
    imageKey: record.imageKey,
    isPublished: record.isPublished,
    sortOrder: record.sortOrder,
    contentManaged: record.contentHash !== null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

const artworkNotFound = () => new NotFoundError('Artwork not found', { code: 'ARTWORK_NOT_FOUND' });
const tagNotFound = () => new NotFoundError('Tag not found', { code: 'TAG_NOT_FOUND' });

/** Translates unique-constraint violations into 409s the client can act on. */
function translateConflict(err: unknown): never {
  if (isUniqueViolation(err, 'artworks_slug_key')) {
    throw new ConflictError('Another artwork already uses this slug', { code: 'SLUG_TAKEN' });
  }
  if (isUniqueViolation(err, 'artworks_image_key_key')) {
    throw new ConflictError('Another artwork already uses this image', { code: 'IMAGE_IN_USE' });
  }
  if (isUniqueViolation(err, 'tags_slug_key')) {
    throw new ConflictError('A tag with this slug already exists', { code: 'TAG_TAKEN' });
  }
  throw err;
}

/** Tag names → unique { name, slug } pairs (two names with the same slug count once). */
function toTagInputs(names: string[]): { name: string; slug: string }[] {
  const bySlug = new Map<string, string>();
  for (const name of names) {
    const slug = slugify(name);
    if (!slug) {
      throw new BusinessRuleError(`Tag "${name}" needs at least one letter or digit`, {
        code: 'INVALID_TAG',
      });
    }
    if (!bySlug.has(slug)) bySlug.set(slug, name);
  }
  return [...bySlug].map(([slug, name]) => ({ name, slug }));
}

// --- Public reads ---

export async function listPublicArtworks(
  query: ListArtworksQuery,
): Promise<{ artworks: Artwork[]; meta: PageMeta }> {
  const { artworks, total } = await galleryRepository.listArtworks({
    ...query,
    status: 'published',
    ...toLimitOffset(query),
  });
  return { artworks: artworks.map(toPublicArtwork), meta: toPageMeta(query, total) };
}

export async function getPublicArtwork(slug: string): Promise<Artwork> {
  const record = await galleryRepository.findBySlug(slug);
  // A draft answers exactly like a missing artwork, so its existence isn't revealed.
  if (!record?.isPublished) throw artworkNotFound();
  return toPublicArtwork(record);
}

export function listCategories(): Promise<CategoryCount[]> {
  return galleryRepository.listPublishedCategories();
}

export function listPublicTags(): Promise<(Tag & { count: number })[]> {
  return galleryRepository.listTags({ publishedOnly: true });
}

// --- Admin ---

export async function listAdminArtworks(
  query: AdminListArtworksQuery,
): Promise<{ artworks: AdminArtwork[]; meta: PageMeta }> {
  const { artworks, total } = await galleryRepository.listArtworks({
    ...query,
    ...toLimitOffset(query),
  });
  return { artworks: artworks.map(toAdminArtwork), meta: toPageMeta(query, total) };
}

export async function getAdminArtwork(id: number): Promise<AdminArtwork> {
  const record = await galleryRepository.findById(id);
  if (!record) throw artworkNotFound();
  return toAdminArtwork(record);
}

function assertAltTextIfPublished(isPublished: boolean, altText: string | null) {
  if (isPublished && !altText) {
    throw new BusinessRuleError('A published artwork needs alt text for screen readers', {
      code: 'ALT_TEXT_REQUIRED',
    });
  }
}

export async function createArtwork(
  input: CreateArtworkInput,
  { mediaDir = MEDIA_DIR }: { mediaDir?: string } = {},
): Promise<AdminArtwork> {
  const { imageKey, tags, sortOrder, ...fields } = input;
  assertAltTextIfPublished(fields.isPublished, fields.altText);

  // Until uploads exist (backlog), images come only from `npm run media`.
  const image = (await loadManifest(mediaDir)).artworks[imageKey];
  if (!image) {
    throw new BusinessRuleError(`No processed image "${imageKey}" in media/manifest.json`, {
      code: 'IMAGE_NOT_FOUND',
    });
  }

  const id = await withTransaction(async (tx) => {
    const row: ArtworkFields = {
      ...fields,
      imageKey,
      thumbPath: image.thumb.src,
      thumbWidth: image.thumb.width,
      thumbHeight: image.thumb.height,
      largePath: image.large.src,
      largeWidth: image.large.width,
      largeHeight: image.large.height,
      isMonochrome: image.monochrome ?? false,
      sortOrder: sortOrder ?? 0,
      contentHash: null,
    };
    const { id: newId } = await galleryRepository.insertArtwork(row, tx).catch(translateConflict);
    await galleryRepository.setArtworkTags(
      newId,
      await galleryRepository.ensureTags(toTagInputs(tags), tx),
      tx,
    );
    return newId;
  });
  return getAdminArtwork(id);
}

export async function updateArtwork(id: number, input: UpdateArtworkInput): Promise<AdminArtwork> {
  const { tags, ...changes } = input;
  await withTransaction(async (tx) => {
    const current = await galleryRepository.findById(id, tx, { forUpdate: true });
    if (!current) throw artworkNotFound();
    assertAltTextIfPublished(
      changes.isPublished ?? current.isPublished,
      changes.altText !== undefined ? changes.altText : current.altText,
    );

    await galleryRepository.updateArtwork(id, changes, tx).catch(translateConflict);
    if (tags) {
      await galleryRepository.setArtworkTags(
        id,
        await galleryRepository.ensureTags(toTagInputs(tags), tx),
        tx,
      );
    }
  });
  return getAdminArtwork(id);
}

export async function deleteArtwork(id: number): Promise<void> {
  const record = await galleryRepository.findById(id);
  if (!record) throw artworkNotFound();
  if (record.contentHash !== null) {
    throw new ConflictError(
      'This artwork comes from content/artworks.json; remove it there (and its photo) instead',
      { code: 'ARTWORK_CONTENT_MANAGED' },
    );
  }
  await galleryRepository.deleteArtwork(id);
}

export function listAllTags(): Promise<(Tag & { count: number })[]> {
  return galleryRepository.listTags({ publishedOnly: false });
}

export async function createTag({ name, slug }: CreateTagInput): Promise<Tag> {
  const tagSlug = slug ?? slugify(name);
  if (!tagSlug) {
    throw new BusinessRuleError('The tag name needs at least one letter or digit', {
      code: 'INVALID_TAG',
    });
  }
  return galleryRepository.insertTag({ name, slug: tagSlug }).catch(translateConflict);
}

export async function updateTag(id: number, changes: UpdateTagInput): Promise<Tag> {
  const tag = await galleryRepository.updateTag(id, changes).catch(translateConflict);
  if (!tag) throw tagNotFound();
  return tag;
}

export async function deleteTag(id: number): Promise<void> {
  if (!(await galleryRepository.deleteTag(id))) throw tagNotFound();
}

// --- Content sync (used by the seed) ---

export interface SyncSummary {
  inserted: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
}

/**
 * Makes the database match content/artworks.json, in one transaction (all or nothing):
 * - new entries are inserted;
 * - entries whose hash changed are rewritten (file wins), including their tags;
 * - unchanged entries are left alone, keeping any admin edits;
 * - file-owned rows whose entry was removed are deleted.
 */
export function syncContent(rows: DesiredArtwork[]): Promise<SyncSummary> {
  return withTransaction(async (tx) => {
    const summary: SyncSummary = { inserted: [], updated: [], removed: [], unchanged: 0 };
    const existing = await galleryRepository.listContentState(tx);
    const byKey = new Map(existing.map((row) => [row.imageKey, row]));

    const claimedByApi = rows.filter((row) => byKey.get(row.imageKey)?.contentHash === null);
    if (claimedByApi.length > 0) {
      throw new ContentError(
        'These images are already used by artworks created through the API:',
        claimedByApi.map((row) => `${row.imageKey} (entry "${row.slug}")`),
      );
    }

    // Removals first, so a new entry may reuse a removed entry's slug.
    const wanted = new Set(rows.map((row) => row.imageKey));
    for (const row of existing) {
      if (row.contentHash !== null && !wanted.has(row.imageKey)) {
        await galleryRepository.deleteArtwork(row.id, tx);
        summary.removed.push(row.imageKey);
      }
    }

    for (const row of rows) {
      const current = byKey.get(row.imageKey);
      if (current?.contentHash === row.contentHash) {
        summary.unchanged += 1;
        continue;
      }

      const { tags, ...fields } = row;
      let id: number;
      try {
        if (current) {
          await galleryRepository.updateArtwork(current.id, fields, tx);
          id = current.id;
          summary.updated.push(row.slug);
        } else {
          ({ id } = await galleryRepository.insertArtwork(fields, tx));
          summary.inserted.push(row.slug);
        }
      } catch (err) {
        if (isUniqueViolation(err, 'artworks_slug_key')) {
          throw new ContentError(`Slug "${row.slug}" is already used by another artwork`, [], {
            cause: err,
          });
        }
        throw err;
      }
      await galleryRepository.setArtworkTags(id, await galleryRepository.ensureTags(tags, tx), tx);
    }
    return summary;
  });
}
