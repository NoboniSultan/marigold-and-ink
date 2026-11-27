/**
 * Product photos (milestone 12a, ADR 0019). Like the gallery's images (ADR 0007), each
 * upload becomes two WebP sizes: turned upright, converted to sRGB, and saved with no
 * metadata, so where and when a photo was taken never reaches storage. Re-encoding also
 * means only a real image can be stored. Names contain a hash of the result, so a changed
 * photo always gets a new address and browsers may cache them forever.
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';

/** The list and thumbnail size (width), and the product page's (long edge). */
export const SMALL_WIDTH = 600;
export const LARGE_EDGE = 1600;

export class NotAPhotoError extends Error {
  constructor(options?: ErrorOptions) {
    super('The file could not be read as an image', options);
    this.name = 'NotAPhotoError';
  }
}

export interface ProcessedPhoto {
  small: Buffer;
  large: Buffer;
  /** The large size's dimensions (its shape, for layout). */
  width: number;
  height: number;
  /** 16 hex characters of the large image's SHA-256. */
  hash: string;
}

function base(data: Buffer) {
  // limitInputPixels guards against "decompression bombs" (tiny files, huge images).
  return sharp(data, { limitInputPixels: 100_000_000 }).rotate().toColorspace('srgb');
}

export async function processProductPhoto(data: Buffer): Promise<ProcessedPhoto> {
  try {
    // No withMetadata(): sharp drops EXIF, GPS, and the rest by default.
    const large = await base(data)
      .resize({ width: LARGE_EDGE, height: LARGE_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const small = await base(data)
      .resize({ width: SMALL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      small,
      large: large.data,
      width: large.info.width,
      height: large.info.height,
      hash: createHash('sha256').update(large.data).digest('hex').slice(0, 16),
    };
  } catch (err) {
    throw new NotAPhotoError({ cause: err });
  }
}

/** Where a product's photo sizes are stored (the database checks this shape too). */
export function photoKeys(productId: number, hash: string) {
  return {
    small: `shop/products/${productId}/${hash}-small.webp`,
    large: `shop/products/${productId}/${hash}-large.webp`,
  };
}

/** A key the public photo route may serve: only product photos, nothing else in storage. */
export const PUBLIC_PHOTO_KEY = /^shop\/products\/[0-9]+\/[a-f0-9]{16}-(small|large)\.webp$/;
