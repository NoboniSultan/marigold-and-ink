import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  LARGE_EDGE,
  NotAPhotoError,
  PUBLIC_PHOTO_KEY,
  SMALL_WIDTH,
  photoKeys,
  processProductPhoto,
} from '../shop.photos.ts';

/** Like a phone photo: GPS and camera details in EXIF, stored sideways. */
function phonePhoto(width = 3000, height = 2000) {
  return sharp({ create: { width, height, channels: 3, background: '#29151c' } })
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'Camera 1' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '43/1 39/1 0/1' },
    })
    .withMetadata({ orientation: 6 }) // 6 = rotate 90°
    .jpeg()
    .toBuffer();
}

describe('processProductPhoto', () => {
  it('makes two upright WebP sizes with no metadata, GPS included', async () => {
    const input = await phonePhoto();
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the fixture really has EXIF

    const photo = await processProductPhoto(input);

    for (const size of [photo.small, photo.large]) {
      const meta = await sharp(size).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
    }
    // Turned upright: the 3000 × 2000 sideways photo is portrait.
    expect({ width: photo.width, height: photo.height }).toEqual({
      width: Math.round((LARGE_EDGE * 2) / 3),
      height: LARGE_EDGE,
    });
    expect((await sharp(photo.small).metadata()).width).toBe(SMALL_WIDTH);
    expect(photo.hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('never enlarges a small photo', async () => {
    const photo = await processProductPhoto(
      await sharp({ create: { width: 300, height: 200, channels: 3, background: '#fff' } })
        .png()
        .toBuffer(),
    );
    expect({ width: photo.width, height: photo.height }).toEqual({ width: 300, height: 200 });
    expect((await sharp(photo.small).metadata()).width).toBe(300);
  });

  it('refuses something that is not an image', async () => {
    await expect(processProductPhoto(Buffer.from('not an image'))).rejects.toBeInstanceOf(
      NotAPhotoError,
    );
  });

  it('stores under keys the public route accepts, and only those', () => {
    const keys = photoKeys(12, '0123456789abcdef');
    expect(keys).toEqual({
      small: 'shop/products/12/0123456789abcdef-small.webp',
      large: 'shop/products/12/0123456789abcdef-large.webp',
    });
    expect(PUBLIC_PHOTO_KEY.test(keys.small)).toBe(true);
    for (const key of [
      'commissions/1/reference/x.jpg',
      'shop/products/12/../../commissions/1.jpg',
      'shop/products/12/0123456789abcdef-small.jpg',
    ]) {
      expect(PUBLIC_PHOTO_KEY.test(key)).toBe(false);
    }
  });
});
