/**
 * media/manifest.json: the record of every processed image, written by `npm run media`
 * and read by the content seed and the About endpoint. Validated on load, so a hand-edited
 * or truncated manifest fails with a clear message instead of producing broken pages.
 */
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { SLUG_PATTERN } from './slug.ts';

export const MANIFEST_FILE = 'manifest.json';

/** App-served WebP only; mirrors the artworks_*_path_check constraints. */
export const MEDIA_SRC_PATTERN = /^\/media\/[a-z0-9][a-z0-9/._-]*\.webp$/;

const imageVariantSchema = z.object({
  src: z
    .string()
    .regex(MEDIA_SRC_PATTERN)
    .refine((src) => !src.includes('..'), 'must not contain ".."'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const manifestImageSchema = z.object({
  /** The original file name in media-source/ (for humans; never served). */
  source: z.string().min(1),
  /** SHA-256 of the original, so unchanged photos are skipped on the next run. */
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Measured by `npm run media`: almost no strongly coloured pixels (black and white). */
  monochrome: z.boolean().optional(),
  thumb: imageVariantSchema,
  large: imageVariantSchema,
});

const imageKeySchema = z.string().regex(SLUG_PATTERN, 'must be a slug');

export const manifestSchema = z.object({
  /** Hash of the processing settings; a change reprocesses every image. */
  settings: z.string().min(1),
  artworks: z.record(imageKeySchema, manifestImageSchema),
  about: z.record(imageKeySchema, manifestImageSchema),
});

export type MediaManifest = z.infer<typeof manifestSchema>;
export type ManifestImage = z.infer<typeof manifestImageSchema>;
export type MediaCollection = 'artworks' | 'about';

export const EMPTY_MANIFEST: MediaManifest = Object.freeze({
  settings: 'none',
  artworks: {},
  about: {},
});

export class ManifestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ManifestError';
  }
}

/** Parses and validates manifest JSON text. */
export function parseManifest(text: string, source = MANIFEST_FILE): MediaManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ManifestError(`${source} is not valid JSON`, { cause: err });
  }
  const result = manifestSchema.safeParse(json);
  if (!result.success) {
    throw new ManifestError(`${source} is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Reads media/manifest.json from `mediaDir`. */
export async function loadManifest(mediaDir: string): Promise<MediaManifest> {
  const file = path.join(mediaDir, MANIFEST_FILE);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    throw new ManifestError(`Can't read ${file}. Run \`npm run media\` first.`, { cause: err });
  }
  return parseManifest(text, file);
}

/** Maps a public /media/... URL to its file inside `mediaDir`. */
export function mediaFilePath(mediaDir: string, src: string): string {
  return path.join(mediaDir, src.replace(/^\/media\//, ''));
}

/**
 * Every image file the manifest names but the disk doesn't have, e.g. because the manifest
 * was committed without the WebP files. The seed refuses to run when this isn't empty.
 */
export async function findMissingMediaFiles(
  manifest: MediaManifest,
  mediaDir: string,
): Promise<string[]> {
  const srcs = [...Object.values(manifest.artworks), ...Object.values(manifest.about)].flatMap(
    (image) => [image.thumb.src, image.large.src],
  );
  const missing = await Promise.all(
    srcs.map((src) =>
      access(mediaFilePath(mediaDir, src)).then(
        () => null,
        () => src,
      ),
    ),
  );
  return missing.filter((src): src is string => src !== null);
}
