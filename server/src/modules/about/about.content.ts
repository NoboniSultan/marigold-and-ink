/**
 * content/about.json: the About page's photo and bio. Pure validation and mapping; the
 * photo key must exist in the "about" section of media/manifest.json.
 */
import path from 'node:path';
import { z } from 'zod';
import type { AboutContent } from '@shared/types/about.ts';
import { ContentError, readContentFile } from '../../lib/contentFile.ts';
import { SLUG_PATTERN } from '../../lib/slug.ts';
import type { MediaManifest } from '../../lib/mediaManifest.ts';

export const ABOUT_FILE = 'about.json';

/** Text starting with this marks owner copy that hasn't been written yet. */
export const PLACEHOLDER_PREFIX = 'PLACEHOLDER:';

export const aboutFileSchema = z
  .object({
    /** Image key from media-source/about (the file name, slugified). */
    photo: z.string().regex(SLUG_PATTERN),
    photoAlt: z.string().trim().min(1).max(300),
    bio: z.array(z.string().trim().min(1).max(3000)).min(1).max(20),
  })
  .strict();

export type AboutFile = z.infer<typeof aboutFileSchema>;

export function loadAboutFile(contentDir: string): Promise<AboutFile> {
  return readContentFile(path.join(contentDir, ABOUT_FILE), aboutFileSchema);
}

export function buildAbout(file: AboutFile, manifest: MediaManifest): AboutContent {
  const image = manifest.about[file.photo];
  if (!image) {
    const available = Object.keys(manifest.about).join(', ') || 'none';
    throw new ContentError(
      `${ABOUT_FILE}: photo "${file.photo}" isn't in media/manifest.json (available: ${available})`,
    );
  }
  return {
    photo: { thumb: image.thumb, large: image.large, alt: file.photoAlt },
    bio: file.bio,
    isPlaceholder: [file.photoAlt, ...file.bio].some((text) => text.startsWith(PLACEHOLDER_PREFIX)),
  };
}
