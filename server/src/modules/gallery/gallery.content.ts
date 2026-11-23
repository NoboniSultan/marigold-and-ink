/**
 * content/artworks.json: the owner-edited source of truth for gallery artworks.
 *
 * This module is pure (no database): it validates the file, cross-checks it against the
 * media manifest, and turns each entry into the exact row the database should hold, with
 * a hash of that row. The seed then writes only rows whose hash changed (see
 * gallery.service.ts `syncContent`).
 *
 * Rules enforced here, all reported together so one run shows every problem:
 * - every processed image has an entry, and every entry points at a processed image;
 * - slugs and image keys are unique;
 * - a published entry has no "to fill in" placeholder left.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ContentError } from '../../lib/contentFile.ts';
import { SLUG_PATTERN, slugify } from '../../lib/slug.ts';
import type { MediaManifest } from '../../lib/mediaManifest.ts';

export const ARTWORKS_FILE = 'artworks.json';

/** Marks a field the owner still has to fill in. Entries containing it stay unpublished. */
export const TO_FILL_IN = 'to fill in';

const slug = z.string().regex(SLUG_PATTERN, 'must be lowercase words joined by hyphens');
const text = (max: number) => z.string().trim().min(1).max(max);
/** Optional fields may be left out or set to null in the file. */
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);

export const artworkEntrySchema = z
  .object({
    /** The image key from media/manifest.json (the source file name, slugified). */
    image: slug,
    /** The artwork's URL: /gallery/<slug>. */
    slug,
    title: text(200),
    category: text(50),
    medium: optional(text(200)),
    year: optional(z.number().int().min(1900).max(2100)),
    credit: optional(text(200)),
    description: optional(text(2000)),
    /** Screen-reader description. Defaults to "<title>, <medium>" when published without one. */
    altText: optional(text(300)),
    /**
     * Black and white? Measured from the image by `npm run media`; set it here only to
     * override the measurement (e.g. an ink drawing photographed on a wooden table).
     */
    monochrome: optional(z.boolean()),
    /** Tag names, e.g. ["Pets"]. Tags are created as needed. */
    tags: z.array(text(50)).default([]),
    published: z.boolean(),
  })
  // Unknown keys are rejected, so a typo like "titel" fails instead of being ignored.
  .strict()
  .superRefine((entry, ctx) => {
    if (!entry.published) return;
    for (const [field, value] of Object.entries(entry)) {
      if (typeof value === 'string' && value.toLowerCase() === TO_FILL_IN) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `still says "${TO_FILL_IN}": fill it in or set "published": false`,
        });
      }
    }
  });

export const artworksFileSchema = z
  .object({
    /** In gallery order: the first entry is shown first. */
    artworks: z.array(artworkEntrySchema),
  })
  .strict();

export type ArtworkEntry = z.infer<typeof artworkEntrySchema>;
export type ArtworksFile = z.infer<typeof artworksFileSchema>;
/** The file as written to disk (before defaults and transforms). */
export type ArtworkEntryInput = z.input<typeof artworkEntrySchema>;

/** The row the database should hold for one entry. */
export interface DesiredArtwork {
  imageKey: string;
  slug: string;
  title: string;
  description: string | null;
  medium: string | null;
  category: string;
  year: number | null;
  credit: string | null;
  altText: string | null;
  isPublished: boolean;
  isMonochrome: boolean;
  sortOrder: number;
  thumbPath: string;
  thumbWidth: number;
  thumbHeight: number;
  largePath: string;
  largeWidth: number;
  largeHeight: number;
  tags: { name: string; slug: string }[];
  /** SHA-256 of everything above: changes whenever the entry or its image changes. */
  contentHash: string;
}

export { ContentError };

/**
 * Parses and validates artworks.json text. Unlike the generic parseContent, messages name
 * the artwork ("artwork "fawn", medium: ...") instead of an array index.
 */
export function parseArtworksFile(json: string, source = ARTWORKS_FILE): ArtworksFile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new ContentError(`${source} is not valid JSON`, [], { cause: err });
  }
  const result = artworksFileSchema.safeParse(data);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const [list, index, field] = issue.path;
      if (list !== 'artworks' || typeof index !== 'number') {
        return `${issue.path.join('.') || '(file)'}: ${issue.message}`;
      }
      // Name the artwork by its slug (or image) rather than its position in the list.
      const entry = (data as { artworks: { slug?: unknown; image?: unknown }[] }).artworks[index];
      const name = String(entry?.slug ?? entry?.image ?? `#${index + 1}`);
      const where = field === undefined ? '' : `, ${String(field)}`;
      return `artwork "${name}"${where}: ${issue.message}`;
    });
    throw new ContentError(`${source} is invalid:`, problems);
  }
  return result.data;
}

export async function loadArtworksFile(contentDir: string): Promise<ArtworksFile> {
  const file = path.join(contentDir, ARTWORKS_FILE);
  return parseArtworksFile(await readFile(file, 'utf8'), file);
}

/** The entry `npm run media` adds for a new image: unpublished until the owner fills it in. */
export function stubEntry(imageKey: string, sourceFileName: string): ArtworkEntryInput {
  return {
    image: imageKey,
    slug: imageKey,
    title: path.parse(sourceFileName).name,
    category: TO_FILL_IN,
    medium: TO_FILL_IN,
    published: false,
  };
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function hashRow(row: Omit<DesiredArtwork, 'contentHash'>): string {
  return createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

/**
 * Cross-checks the content file against the manifest and builds the desired rows.
 * Throws a ContentError listing every problem at once.
 */
export function buildArtworkRows(file: ArtworksFile, manifest: MediaManifest): DesiredArtwork[] {
  const problems: string[] = [];
  const entries = file.artworks;

  for (const key of findDuplicates(entries.map((e) => e.slug))) {
    problems.push(`slug "${key}" is used by more than one artwork`);
  }
  for (const key of findDuplicates(entries.map((e) => e.image))) {
    problems.push(`image "${key}" is used by more than one artwork`);
  }

  const described = new Set(entries.map((e) => e.image));
  for (const [key, image] of Object.entries(manifest.artworks)) {
    if (!described.has(key)) {
      problems.push(
        `image "${key}" (${image.source}) has no entry in ${ARTWORKS_FILE}; run \`npm run media\` to add one`,
      );
    }
  }

  const rows: DesiredArtwork[] = [];
  entries.forEach((entry, index) => {
    const image = manifest.artworks[entry.image];
    if (!image) {
      problems.push(
        `artwork "${entry.slug}" uses image "${entry.image}", which isn't in media/manifest.json`,
      );
      return;
    }

    const tagSlugs = entry.tags.map((name) => ({ name, slug: slugify(name) }));
    for (const tag of tagSlugs) {
      if (!SLUG_PATTERN.test(tag.slug)) {
        problems.push(`artwork "${entry.slug}" has a tag with no letters or digits: "${tag.name}"`);
      }
    }

    const defaultAlt = entry.medium ? `${entry.title}, ${entry.medium}` : entry.title;
    const row: Omit<DesiredArtwork, 'contentHash'> = {
      imageKey: entry.image,
      slug: entry.slug,
      title: entry.title,
      description: entry.description,
      medium: entry.medium,
      category: entry.category,
      year: entry.year,
      credit: entry.credit,
      altText: entry.altText ?? (entry.published ? defaultAlt : null),
      isPublished: entry.published,
      isMonochrome: entry.monochrome ?? image.monochrome ?? false,
      // Gaps of 10 leave room to slot an API-created artwork between file entries.
      sortOrder: (index + 1) * 10,
      thumbPath: image.thumb.src,
      thumbWidth: image.thumb.width,
      thumbHeight: image.thumb.height,
      largePath: image.large.src,
      largeWidth: image.large.width,
      largeHeight: image.large.height,
      tags: tagSlugs,
    };
    rows.push({ ...row, contentHash: hashRow(row) });
  });

  if (problems.length > 0) {
    throw new ContentError(`${ARTWORKS_FILE} doesn't match media/manifest.json:`, problems);
  }
  return rows;
}
