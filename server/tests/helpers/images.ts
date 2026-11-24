/** Small real images for upload tests, made with sharp. */
import sharp from 'sharp';

/** A solid JPEG, `width` × `height`, carrying EXIF data (a camera's maker note and a copyright). */
export function jpegWithExif(width = 120, height = 80) {
  return sharp({ create: { width, height, channels: 3, background: '#c86432' } })
    .withExif({ IFD0: { Copyright: 'secret camera owner', Make: 'TestCam' } })
    .jpeg()
    .toBuffer();
}

export function png(width = 60, height = 60) {
  return sharp({ create: { width, height, channels: 4, background: '#2a6' } })
    .png()
    .toBuffer();
}

/** A minimal PDF (the bytes a real one starts with, and an end). */
export const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n',
);
