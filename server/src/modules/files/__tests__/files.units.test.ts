import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  MAX_IMAGE_EDGE,
  cleanFilename,
  detectType,
  processPreview,
  processReference,
  NotAnImageError,
} from '../files.processing.ts';
import {
  acceptsDeliverables,
  deleteAfter,
  referencesOpen,
  DELIVERABLE_KEEP_DAYS,
  REFERENCE_KEEP_DAYS,
} from '../files.rules.ts';
import { PDF, jpegWithExif, png } from '../../../../tests/helpers/images.ts';

describe('detectType', () => {
  it('reads the real type from the first bytes', async () => {
    expect(detectType(await jpegWithExif())).toBe('image/jpeg');
    expect(detectType(await png())).toBe('image/png');
    expect(detectType(PDF)).toBe('application/pdf');
    expect(
      detectType(
        await sharp(await png())
          .webp()
          .toBuffer(),
      ),
    ).toBe('image/webp');
    expect(
      detectType(
        await sharp(await png())
          .tiff()
          .toBuffer(),
      ),
    ).toBe('image/tiff');
    expect(detectType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectType(Buffer.alloc(0))).toBeNull();
  });
});

describe('processReference', () => {
  it('turns a sideways photo upright, using its orientation tag', async () => {
    // 60 wide × 30 tall, tagged "rotate 90° clockwise to view" (EXIF orientation 6).
    const sideways = await sharp({
      create: { width: 60, height: 30, channels: 3, background: '#000' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await processReference(sideways);
    expect([out.width, out.height]).toEqual([30, 60]);
  });

  it('never enlarges a small photo, and shrinks a big one to the edge limit', async () => {
    expect((await processReference(await png(50, 40))).width).toBe(50);
    const big = await processReference(await jpegWithExif(4000, 1000));
    expect([big.width, big.height]).toEqual([MAX_IMAGE_EDGE, 600]);
  });

  it('refuses what is not an image', async () => {
    await expect(processReference(Buffer.from('nope'))).rejects.toBeInstanceOf(NotAnImageError);
    await expect(processPreview(Buffer.from('nope'))).rejects.toBeInstanceOf(NotAnImageError);
  });
});

describe('processPreview', () => {
  it('marks even an image smaller than the watermark tile', async () => {
    const white = await sharp({
      create: { width: 100, height: 80, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const out = await processPreview(white);
    expect([out.width, out.height]).toEqual([100, 80]);
    expect((await sharp(out.data).stats()).channels[0]!.min).toBeLessThan(250);
  });
});

describe('cleanFilename', () => {
  it('keeps just the name: decoded, no folders, no control characters, at most 200 characters', () => {
    expect(cleanFilename(encodeURIComponent('Benito on the sofa.jpg'), 'x')).toBe(
      'Benito on the sofa.jpg',
    );
    expect(cleanFilename('..%2F..%2Fetc%2Fpasswd', 'x')).toBe('passwd');
    expect(cleanFilename('C:\\photos\\cat.png', 'x')).toBe('cat.png');
    expect(cleanFilename('bad%E0%A4%A.jpg', 'x')).toBe('bad%E0%A4%A.jpg'); // not valid encoding: as is
    expect(cleanFilename('a\u0000b.jpg', 'x')).toBe('ab.jpg');
    expect(cleanFilename('n'.repeat(300), 'x')).toHaveLength(200);
    expect(cleanFilename(undefined, 'reference.jpg')).toBe('reference.jpg');
    expect(cleanFilename('   ', 'reference.jpg')).toBe('reference.jpg');
  });
});

describe('files.rules', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000);

  it('keeps reference photos 90 days after the commission ends, and not before it ends', () => {
    expect(deleteAfter('reference', { paidInFullAt: day(0), endedAt: day(10) })).toEqual(
      day(10 + REFERENCE_KEEP_DAYS),
    );
    expect(deleteAfter('reference', { paidInFullAt: day(0), endedAt: null })).toBeNull();
  });

  it('keeps previews and finals a year after full payment, or 90 days after an unpaid end', () => {
    expect(deleteAfter('final', { paidInFullAt: day(5), endedAt: day(9) })).toEqual(
      day(5 + DELIVERABLE_KEEP_DAYS),
    );
    expect(deleteAfter('preview', { paidInFullAt: null, endedAt: day(9) })).toEqual(
      day(9 + REFERENCE_KEEP_DAYS),
    );
    expect(deleteAfter('preview', { paidInFullAt: null, endedAt: null })).toBeNull();
  });

  it('opens reference photos until work starts, and deliverables after the deposit', () => {
    expect(['inquiry', 'quoted', 'deposit_paid', 'in_progress'].map(referencesOpen)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(['quoted', 'deposit_paid', 'delivered', 'canceled'].map(acceptsDeliverables)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});
