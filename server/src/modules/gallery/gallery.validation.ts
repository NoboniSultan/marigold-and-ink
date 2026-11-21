import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { SLUG_PATTERN } from '../../lib/slug.ts';

const slug = z.string().trim().regex(SLUG_PATTERN, 'must be lowercase words joined by hyphens');
const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.coerce.number().int().positive();

export const artworkSlugParams = z.object({ slug });
export const idParams = z.object({ id });

export const listArtworksQuery = paginationQuery.extend({
  category: text(50).optional(),
  tag: slug.optional(),
  q: text(200).optional(),
});

export const adminListArtworksQuery = listArtworksQuery.extend({
  status: z.enum(['all', 'published', 'draft']).default('all'),
});

// Optional text fields accept null, which clears them on update.
const artworkFields = {
  slug,
  title: text(200),
  category: text(50),
  medium: text(200).nullable(),
  year: z.number().int().min(1900).max(2100).nullable(),
  credit: text(200).nullable(),
  description: text(2000).nullable(),
  altText: text(300).nullable(),
  /** Tag names; tags are created as needed. Replaces the artwork's tags. */
  tags: z.array(text(50)).max(20),
  isPublished: z.boolean(),
  sortOrder: z.number().int().min(0).max(1_000_000),
};

export const createArtworkBody = z
  .object({
    /** A processed image from media/manifest.json that no artwork uses yet. */
    imageKey: slug,
    ...artworkFields,
    medium: artworkFields.medium.default(null),
    year: artworkFields.year.default(null),
    credit: artworkFields.credit.default(null),
    description: artworkFields.description.default(null),
    altText: artworkFields.altText.default(null),
    tags: artworkFields.tags.default([]),
    isPublished: artworkFields.isPublished.default(false),
    sortOrder: artworkFields.sortOrder.optional(),
  })
  .strict();

export const updateArtworkBody = z
  .object(artworkFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');

export const createTagBody = z.object({ name: text(50), slug: slug.optional() }).strict();

export const updateTagBody = z
  .object({ name: text(50), slug })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');

export type ListArtworksQuery = z.infer<typeof listArtworksQuery>;
export type AdminListArtworksQuery = z.infer<typeof adminListArtworksQuery>;
export type CreateArtworkInput = z.infer<typeof createArtworkBody>;
export type UpdateArtworkInput = z.infer<typeof updateArtworkBody>;
export type CreateTagInput = z.infer<typeof createTagBody>;
export type UpdateTagInput = z.infer<typeof updateTagBody>;
