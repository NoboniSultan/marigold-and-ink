/**
 * Image processing for `npm run media`: originals in media-source/ become two WebP sizes
 * in media/, recorded in media/manifest.json.
 *
 * - Auto-rotates from the camera's orientation tag, then strips ALL metadata (EXIF, GPS
 *   location, camera serials). Sharp drops metadata unless asked to keep it; a test checks.
 * - Converts to sRGB, so phone photos in Display P3 look the same in every browser.
 * - File names carry a hash of their content (fawn.thumb.3fa9c2d1.webp), so the server can
 *   tell browsers to cache them forever: a changed image gets a new name.
 * - Unchanged originals are skipped (compared by SHA-256), so re-runs are fast and produce
 *   no git changes.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { slugify } from '../../src/lib/slug.ts';
import { mediaFilePath } from '../../src/lib/mediaManifest.ts';
import type { ManifestImage, MediaCollection } from '../../src/lib/mediaManifest.ts';

const execFileAsync = promisify(execFile);

export const SETTINGS = Object.freeze({
  /** Grid cards are at most ~300 CSS px wide, so 600px covers 2x (retina) screens. */
  thumbWidth: 600,
  /** Detail view: the longest edge, enough for a full-screen view on large displays. */
  largeMaxEdge: 2000,
  webp: Object.freeze({ quality: 82, effort: 5 }),
});

/** Changing SETTINGS changes this ID, and the next run reprocesses everything. */
export const SETTINGS_ID = createHash('sha256')
  .update(JSON.stringify(SETTINGS))
  .digest('hex')
  .slice(0, 12);

export const SUPPORTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.tif',
  '.tiff',
  '.avif',
  '.heic',
  '.heif',
]);

/** Sharp's prebuilt libvips can't decode HEVC-based HEIC (patent licensing), so macOS converts it. */
const NEEDS_SIPS = new Set(['.heic', '.heif']);

export interface Variant {
  buffer: Buffer;
  width: number;
  height: number;
}

export interface CollectionResult {
  images: Record<string, ManifestImage>;
  processed: string[];
  unchanged: string[];
  skipped: string[];
}

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** "IMG_0177.heic" → "img-0177". The key links manifest, content entry, and database row. */
export function imageKeyFor(fileName: string): string {
  return slugify(path.parse(fileName).name);
}

export function variantFileName(key: string, size: 'thumb' | 'large', buffer: Buffer): string {
  return `${key}.${size}.${sha256(buffer).slice(0, 8)}.webp`;
}

/** Converts HEIC to a lossless PNG with macOS's built-in `sips`, returning the PNG's path. */
async function decodeWithSips(file: string, tmpDir: string): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new Error(`${path.basename(file)}: HEIC needs macOS (sips). Export it as JPEG instead.`);
  }
  const out = path.join(tmpDir, `${path.parse(file).name}.png`);
  await execFileAsync('sips', ['-s', 'format', 'png', file, '--out', out]);
  return out;
}

/** Renders the thumbnail and large sizes. Output carries no metadata. */
export async function renderVariants(input: string): Promise<{ thumb: Variant; large: Variant }> {
  // failOn 'error' rejects truncated or corrupt files instead of rendering a grey half-image.
  const base = sharp(input, { failOn: 'error' }).rotate().toColourspace('srgb');
  const max = SETTINGS.largeMaxEdge;

  const [thumb, large] = await Promise.all([
    base
      .clone()
      .resize({ width: SETTINGS.thumbWidth, withoutEnlargement: true })
      .webp(SETTINGS.webp)
      .toBuffer({ resolveWithObject: true }),
    base
      .clone()
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .webp(SETTINGS.webp)
      .toBuffer({ resolveWithObject: true }),
  ]);

  const toVariant = ({ data, info }: typeof thumb): Variant => ({
    buffer: data,
    width: info.width,
    height: info.height,
  });
  return { thumb: toVariant(thumb), large: toVariant(large) };
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

/** Lists supported originals in `sourceDir`, sorted; returns unsupported names separately. */
export async function listSources(
  sourceDir: string,
): Promise<{ files: string[]; unsupported: string[] }> {
  const names = await readdir(sourceDir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [] as string[];
    throw err;
  });
  const visible = names.filter((name) => !name.startsWith('.')).sort();
  return {
    files: visible.filter((n) => SUPPORTED_EXTENSIONS.has(path.extname(n).toLowerCase())),
    unsupported: visible.filter((n) => !SUPPORTED_EXTENSIONS.has(path.extname(n).toLowerCase())),
  };
}

/**
 * Processes one collection (artworks or about): renders new or changed originals, reuses
 * manifest entries for unchanged ones, and writes the WebP files into `mediaDir/collection`.
 */
export async function processCollection({
  collection,
  sourceDir,
  mediaDir,
  previous,
  force,
}: {
  collection: MediaCollection;
  sourceDir: string;
  mediaDir: string;
  previous: Record<string, ManifestImage>;
  force: boolean;
}): Promise<CollectionResult> {
  const { files, unsupported } = await listSources(sourceDir);
  const outDir = path.join(mediaDir, collection);
  await mkdir(outDir, { recursive: true });

  const keys = new Map<string, string>();
  for (const file of files) {
    const key = imageKeyFor(file);
    if (!key) throw new Error(`${collection}/${file}: the file name has no letters or digits`);
    const clash = keys.get(key);
    if (clash) {
      throw new Error(`${collection}/${clash} and ${file} both become "${key}"; rename one`);
    }
    keys.set(key, file);
  }

  const result: CollectionResult = {
    images: {},
    processed: [],
    unchanged: [],
    skipped: unsupported,
  };
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'marigold-media-'));
  try {
    for (const [key, file] of keys) {
      const sourcePath = path.join(sourceDir, file);
      const sourceHash = sha256(await readFile(sourcePath));
      const before = previous[key];

      // Reuse the previous output only if the original is byte-identical and both files
      // are still on disk (someone may have deleted media/ to start over).
      const reusable =
        !force &&
        before?.sourceHash === sourceHash &&
        (await exists(mediaFilePath(mediaDir, before.thumb.src))) &&
        (await exists(mediaFilePath(mediaDir, before.large.src)));
      if (reusable && before) {
        result.images[key] = { ...before, source: file };
        result.unchanged.push(key);
        continue;
      }

      const input = NEEDS_SIPS.has(path.extname(file).toLowerCase())
        ? await decodeWithSips(sourcePath, tmpDir)
        : sourcePath;
      const { thumb, large } = await renderVariants(input);

      const save = async (size: 'thumb' | 'large', variant: Variant) => {
        const name = variantFileName(key, size, variant.buffer);
        await writeFile(path.join(outDir, name), variant.buffer);
        return {
          src: `/media/${collection}/${name}`,
          width: variant.width,
          height: variant.height,
        };
      };
      result.images[key] = {
        source: file,
        sourceHash,
        thumb: await save('thumb', thumb),
        large: await save('large', large),
      };
      result.processed.push(key);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
  return result;
}

/** Deletes .webp files in `mediaDir/collection` that the manifest no longer references. */
export async function removeStaleFiles(
  mediaDir: string,
  collection: MediaCollection,
  images: Record<string, ManifestImage>,
): Promise<string[]> {
  const dir = path.join(mediaDir, collection);
  const keep = new Set(
    Object.values(images).flatMap((img) => [
      path.basename(img.thumb.src),
      path.basename(img.large.src),
    ]),
  );
  const names = await readdir(dir).catch(() => [] as string[]);
  const stale = names.filter((name) => name.endsWith('.webp') && !keep.has(name));
  await Promise.all(stale.map((name) => rm(path.join(dir, name))));
  return stale;
}
