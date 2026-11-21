import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  SETTINGS,
  imageKeyFor,
  listSources,
  processCollection,
  removeStaleFiles,
  renderVariants,
} from '../pipeline.ts';

let tmp: string;
let sourceDir: string;
let mediaDir: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'media-test-'));
  sourceDir = path.join(tmp, 'source');
  mediaDir = path.join(tmp, 'media');
  await mkdir(sourceDir);
});

afterEach(() => rm(tmp, { recursive: true, force: true }));

/** A JPEG like a phone photo: GPS location and camera details in EXIF, stored sideways. */
async function phonePhoto(file: string, { width = 3000, height = 2000, orientation = 6 } = {}) {
  await sharp({ create: { width, height, channels: 3, background: '#29151c' } })
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'Camera 1' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '43/1 39/1 0/1' },
    })
    .withMetadata({ orientation })
    .jpeg()
    .toFile(file);
}

describe('renderVariants', () => {
  it('strips all metadata, including GPS location', async () => {
    const file = path.join(sourceDir, 'photo.jpg');
    await phonePhoto(file);
    expect((await sharp(file).metadata()).exif).toBeDefined(); // the fixture really has EXIF

    const { thumb, large } = await renderVariants(file);

    for (const variant of [thumb, large]) {
      const meta = await sharp(variant.buffer).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
    }
  });

  it('applies the camera orientation, so a sideways photo comes out upright', async () => {
    const file = path.join(sourceDir, 'photo.jpg');
    await phonePhoto(file, { width: 3000, height: 2000, orientation: 6 }); // 6 = rotate 90°

    const { large } = await renderVariants(file);

    expect(large.height).toBeGreaterThan(large.width);
  });

  it('sizes the thumbnail by width and the large image by its longest edge', async () => {
    const file = path.join(sourceDir, 'photo.jpg');
    await phonePhoto(file, { width: 4000, height: 3000, orientation: 1 });

    const { thumb, large } = await renderVariants(file);

    expect(thumb).toMatchObject({ width: SETTINGS.thumbWidth, height: 450 });
    expect(large).toMatchObject({ width: SETTINGS.largeMaxEdge, height: 1500 });
  });

  it('never enlarges a small original', async () => {
    const file = path.join(sourceDir, 'small.jpg');
    await phonePhoto(file, { width: 400, height: 300, orientation: 1 });

    const { thumb, large } = await renderVariants(file);

    expect(thumb).toMatchObject({ width: 400, height: 300 });
    expect(large).toMatchObject({ width: 400, height: 300 });
  });

  it('rejects a truncated file instead of rendering half an image', async () => {
    const file = path.join(sourceDir, 'broken.jpg');
    const good = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    await writeFile(file, good.subarray(0, good.length / 2));

    await expect(renderVariants(file)).rejects.toThrow();
  });
});

describe('imageKeyFor', () => {
  it.each([
    ['IMG_0177.heic', 'img-0177'],
    ['Starry Night.JPG', 'starry-night'],
    ['guayasamin-embrace-replica-with-charcoal.jpg', 'guayasamin-embrace-replica-with-charcoal'],
    ['Guayasamín.png', 'guayasamin'],
  ])('%s → %s', (file, key) => {
    expect(imageKeyFor(file)).toBe(key);
  });
});

describe('listSources', () => {
  it('lists supported images, hides dotfiles, and reports unsupported files', async () => {
    await writeFile(path.join(sourceDir, '.DS_Store'), '');
    await writeFile(path.join(sourceDir, 'notes.txt'), '');
    await writeFile(path.join(sourceDir, 'b.JPG'), '');
    await writeFile(path.join(sourceDir, 'a.heic'), '');

    expect(await listSources(sourceDir)).toEqual({
      files: ['a.heic', 'b.JPG'],
      unsupported: ['notes.txt'],
    });
  });

  it('treats a missing folder as empty', async () => {
    expect(await listSources(path.join(tmp, 'nope'))).toEqual({ files: [], unsupported: [] });
  });
});

describe('processCollection', () => {
  const run = (previous = {}, force = false) =>
    processCollection({ collection: 'artworks', sourceDir, mediaDir, previous, force });

  it('writes content-hashed WebP files and records them in the manifest entry', async () => {
    await phonePhoto(path.join(sourceDir, 'Fawn.jpg'), { orientation: 1 });

    const result = await run();

    expect(result.processed).toEqual(['fawn']);
    const entry = result.images.fawn!;
    expect(entry.source).toBe('Fawn.jpg');
    expect(entry.thumb.src).toMatch(/^\/media\/artworks\/fawn\.thumb\.[0-9a-f]{8}\.webp$/);
    expect(entry.large.src).toMatch(/^\/media\/artworks\/fawn\.large\.[0-9a-f]{8}\.webp$/);
    expect((await readdir(path.join(mediaDir, 'artworks'))).sort()).toEqual(
      [path.basename(entry.large.src), path.basename(entry.thumb.src)].sort(),
    );
  });

  it('skips originals that have not changed, and reprocesses them when forced', async () => {
    await phonePhoto(path.join(sourceDir, 'fawn.jpg'), { orientation: 1 });
    const first = await run();

    const second = await run(first.images);
    expect(second.unchanged).toEqual(['fawn']);
    expect(second.images).toEqual(first.images);

    const forced = await run(first.images, true);
    expect(forced.processed).toEqual(['fawn']);
  });

  it('reprocesses an original whose content changed', async () => {
    const file = path.join(sourceDir, 'fawn.jpg');
    await phonePhoto(file, { orientation: 1 });
    const first = await run();

    await phonePhoto(file, { width: 1000, height: 1000, orientation: 1 });
    const second = await run(first.images);

    expect(second.processed).toEqual(['fawn']);
    expect(second.images.fawn!.large.src).not.toBe(first.images.fawn!.large.src);
  });

  it('refuses two files that would get the same key', async () => {
    await phonePhoto(path.join(sourceDir, 'fawn.jpg'), { orientation: 1 });
    await phonePhoto(path.join(sourceDir, 'Fawn.png'), { orientation: 1 });

    await expect(run()).rejects.toThrow(/both become "fawn"/);
  });
});

describe('removeStaleFiles', () => {
  it('deletes only WebP files the manifest no longer references', async () => {
    await phonePhoto(path.join(sourceDir, 'fawn.jpg'), { orientation: 1 });
    const { images } = await processCollection({
      collection: 'artworks',
      sourceDir,
      mediaDir,
      previous: {},
      force: false,
    });
    const dir = path.join(mediaDir, 'artworks');
    await writeFile(path.join(dir, 'old.thumb.12345678.webp'), '');
    await writeFile(path.join(dir, 'README.txt'), '');

    const removed = await removeStaleFiles(mediaDir, 'artworks', images);

    expect(removed).toEqual(['old.thumb.12345678.webp']);
    expect(await readdir(dir)).toContain('README.txt');
  });
});
