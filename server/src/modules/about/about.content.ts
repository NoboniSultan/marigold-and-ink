/**
 * content/about.json: the About page's photos and bio. Pure validation and mapping; photo
 * keys must exist in the "about" section of media/manifest.json.
 */
import path from 'node:path';
import { z } from 'zod';
import type { AboutContent, AboutPhoto } from '@shared/types/about.ts';
import { ContentError, readContentFile } from '../../lib/contentFile.ts';
import { SLUG_PATTERN } from '../../lib/slug.ts';
import type { MediaManifest } from '../../lib/mediaManifest.ts';

export const ABOUT_FILE = 'about.json';

/** Text starting with this marks owner copy that hasn't been written yet. */
export const PLACEHOLDER_PREFIX = 'PLACEHOLDER:';

const imageKey = z.string().regex(SLUG_PATTERN);
const altText = z.string().trim().min(1).max(300);

export const aboutFileSchema = z
  .object({
    /** Main photo: an image key from media-source/about (the file name, slugified). */
    photo: imageKey,
    photoAlt: altText,
    bio: z.array(z.string().trim().min(1).max(3000)).min(1).max(20),
    /** Optional second photo, shown at the bottom of the page. */
    closingPhoto: imageKey.optional(),
    closingPhotoAlt: altText.optional(),
  })
  .strict()
  .refine((file) => (file.closingPhoto === undefined) === (file.closingPhotoAlt === undefined), {
    message: 'closingPhoto and closingPhotoAlt go together: set both or neither',
    path: ['closingPhotoAlt'],
  });

export type AboutFile = z.infer<typeof aboutFileSchema>;

export function loadAboutFile(contentDir: string): Promise<AboutFile> {
  return readContentFile(path.join(contentDir, ABOUT_FILE), aboutFileSchema);
}

function photoFrom(manifest: MediaManifest, key: string, alt: string, field: string): AboutPhoto {
  const image = manifest.about[key];
  if (!image) {
    const available = Object.keys(manifest.about).join(', ') || 'none';
    throw new ContentError(
      `${ABOUT_FILE}: ${field} "${key}" isn't in media/manifest.json (available: ${available})`,
    );
  }
  return { thumb: image.thumb, large: image.large, alt };
}

export function buildAbout(file: AboutFile, manifest: MediaManifest): AboutContent {
  const texts = [file.photoAlt, file.closingPhotoAlt ?? '', ...file.bio];
  return {
    photo: photoFrom(manifest, file.photo, file.photoAlt, 'photo'),
    bio: file.bio,
    closingPhoto:
      file.closingPhoto && file.closingPhotoAlt
        ? photoFrom(manifest, file.closingPhoto, file.closingPhotoAlt, 'closingPhoto')
        : null,
    isPlaceholder: texts.some((text) => text.startsWith(PLACEHOLDER_PREFIX)),
  };
}
