/**
 * What happens to an uploaded file before it is stored (milestone 10, ADR 0016):
 *
 * - Reference photos and previews are decoded and re-encoded as JPEG with sharp: turned
 *   upright (EXIF orientation), shrunk to at most 2400 px on the long edge, and saved with
 *   no metadata, so the location, camera, and time a photo was taken never reach storage.
 *   Re-encoding also means only a real image can be stored, never a file dressed up as one.
 * - Previews also get the watermark tile, repeated across the whole image.
 * - Final files are stored as uploaded (they are the deliverable), after their first bytes
 *   are checked to really be one of the allowed types.
 */
import path from 'node:path';
import sharp, { type Sharp } from 'sharp';

/** Long edge for stored reference photos and previews: plenty to paint from or to judge. */
export const MAX_IMAGE_EDGE = 2400;

/** Drawn once by scripts/watermark/makeTile.ts; see there. */
const WATERMARK_TILE = path.join(import.meta.dirname, '../../../assets/watermark-tile.png');
const TILE_WIDTH = 640;
const TILE_HEIGHT = 420;

export type DetectedType =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/tiff' | 'application/pdf';

/** The file's real type, from its first bytes ("magic numbers"), or null if unknown. */
export function detectType(data: Buffer): DetectedType | null {
  const starts = (bytes: number[], at = 0) => bytes.every((b, i) => data[at + i] === b);
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (starts([0x49, 0x49, 0x2a, 0x00]) || starts([0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff';
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  return null;
}

export class NotAnImageError extends Error {
  constructor(options?: ErrorOptions) {
    super('The file could not be read as an image', options);
    this.name = 'NotAnImageError';
  }
}

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
}

function upright(data: Buffer) {
  // limitInputPixels guards against "decompression bombs": tiny files that expand to
  // billions of pixels. 100 megapixels is far beyond any phone or camera photo.
  return sharp(data, { limitInputPixels: 100_000_000 }).rotate().resize({
    width: MAX_IMAGE_EDGE,
    height: MAX_IMAGE_EDGE,
    fit: 'inside',
    withoutEnlargement: true,
  });
}

async function toJpeg(pipeline: Sharp): Promise<ProcessedImage> {
  try {
    // No withMetadata(): sharp drops EXIF, GPS, and the rest by default.
    const { data, info } = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer({
      resolveWithObject: true,
    });
    return { data, width: info.width, height: info.height };
  } catch (err) {
    throw new NotAnImageError({ cause: err });
  }
}

/** A reference photo: upright, at most 2400 px, JPEG, no metadata. */
export function processReference(data: Buffer): Promise<ProcessedImage> {
  return toJpeg(upright(data));
}

/** A preview: like a reference photo, with the watermark tiled over all of it. */
export async function processPreview(data: Buffer): Promise<ProcessedImage> {
  let flat: Buffer;
  try {
    // Resize first (a separate step), so the tile keeps its size on any image.
    flat = await upright(data).toBuffer();
  } catch (err) {
    throw new NotAnImageError({ cause: err });
  }
  // The tile repeats across the image; on an image smaller than the tile, it's shrunk to
  // fit (sharp can't lay an overlay bigger than the image).
  const { width = 0, height = 0 } = await sharp(flat).metadata();
  const tile =
    width < TILE_WIDTH || height < TILE_HEIGHT
      ? await sharp(WATERMARK_TILE).resize({ width, height, fit: 'inside' }).toBuffer()
      : WATERMARK_TILE;
  return toJpeg(sharp(flat).composite([{ input: tile, tile: true, blend: 'over' }]));
}

/** A safe name to keep and offer back on download: no folders, no control characters. */
export function cleanFilename(raw: string | undefined, fallback: string): string {
  let name = raw ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // not URI-encoded: use as is
  }
  name = name
    .split(/[\\/]/)
    .pop()!
    .replace(/[\p{Cc}]/gu, '')
    .trim()
    .slice(0, 200);
  return name || fallback;
}
