import { describe, it, expect } from 'vitest';
import {
  ContentError,
  TO_FILL_IN,
  buildArtworkRows,
  parseArtworksFile,
  stubEntry,
  type ArtworkEntryInput,
} from '../gallery.content.ts';
import type { ManifestImage, MediaManifest } from '../../../lib/mediaManifest.ts';

function image(key: string): ManifestImage {
  return {
    source: `${key}.jpg`,
    sourceHash: 'a'.repeat(64),
    thumb: { src: `/media/artworks/${key}.thumb.11111111.webp`, width: 600, height: 800 },
    large: { src: `/media/artworks/${key}.large.22222222.webp`, width: 1500, height: 2000 },
  };
}

function manifestWith(...keys: string[]): MediaManifest {
  return {
    settings: 'test',
    artworks: Object.fromEntries(keys.map((key) => [key, image(key)])),
    about: {},
  };
}

const fawn: ArtworkEntryInput = {
  image: 'fawn',
  slug: 'fawn',
  title: 'Fawn',
  category: 'nature',
  medium: 'scratchboard',
  published: true,
};

const parse = (...artworks: unknown[]) => parseArtworksFile(JSON.stringify({ artworks }));

/** Runs fn and returns the ContentError it throws, so tests can inspect every problem. */
function contentError(fn: () => unknown): ContentError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ContentError) return err;
    throw err;
  }
  throw new Error('expected a ContentError');
}

describe('parseArtworksFile', () => {
  it('fills defaults: optional fields become null, tags an empty list', () => {
    expect(parse(fawn).artworks[0]).toEqual({
      ...fawn,
      year: null,
      credit: null,
      description: null,
      altText: null,
      monochrome: null,
      tags: [],
    });
  });

  it('rejects an unknown field, so a typo is caught instead of ignored', () => {
    const err = contentError(() => parse({ ...fawn, titel: 'Fawn' }));
    expect(err.problems.join()).toMatch(/artwork "fawn".*titel/);
  });

  it(`refuses to publish an entry that still says "${TO_FILL_IN}"`, () => {
    const err = contentError(() => parse({ ...fawn, medium: 'To Fill In' }));
    expect(err.problems).toEqual([expect.stringMatching(/artwork "fawn", medium: still says/)]);
  });

  it(`allows "${TO_FILL_IN}" on an unpublished entry`, () => {
    expect(() => parse(stubEntry('img-0177', 'IMG_0177.heic'))).not.toThrow();
  });

  it('rejects a slug that is not URL-safe', () => {
    expect(() => parse({ ...fawn, slug: 'Fawn Drawing' })).toThrow(ContentError);
  });

  it('reports invalid JSON clearly', () => {
    expect(() => parseArtworksFile('{ "artworks": [', 'artworks.json')).toThrow(
      'artworks.json is not valid JSON',
    );
  });
});

describe('stubEntry', () => {
  it('uses the file name as the title and stays unpublished', () => {
    expect(stubEntry('img-0177', 'IMG_0177.heic')).toEqual({
      image: 'img-0177',
      slug: 'img-0177',
      title: 'IMG_0177',
      category: TO_FILL_IN,
      medium: TO_FILL_IN,
      published: false,
    });
  });
});

describe('buildArtworkRows', () => {
  it('builds the database row from the entry and its processed image', () => {
    const [row] = buildArtworkRows(parse(fawn), manifestWith('fawn'));

    expect(row).toMatchObject({
      imageKey: 'fawn',
      slug: 'fawn',
      isPublished: true,
      sortOrder: 10,
      thumbPath: '/media/artworks/fawn.thumb.11111111.webp',
      largeWidth: 1500,
      largeHeight: 2000,
      tags: [],
    });
    expect(row!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("takes black and white from the image's measurement, unless the entry overrides it", () => {
    const manifest = manifestWith('fawn', 'owl', 'cat');
    manifest.artworks.fawn!.monochrome = true;
    manifest.artworks.owl!.monochrome = false;
    const rows = buildArtworkRows(
      parse(
        fawn,
        { ...fawn, image: 'owl', slug: 'owl', title: 'Owl', monochrome: true },
        { ...fawn, image: 'cat', slug: 'cat', title: 'Cat' },
      ),
      manifest,
    );
    // Measured; overridden; not measured yet (an old manifest) counts as colour.
    expect(rows.map((r) => [r.slug, r.isMonochrome])).toEqual([
      ['fawn', true],
      ['owl', true],
      ['cat', false],
    ]);
  });

  it('orders artworks as they appear in the file, in steps of 10', () => {
    const rows = buildArtworkRows(
      parse(fawn, { ...fawn, image: 'owl', slug: 'owl', title: 'Owl' }),
      manifestWith('fawn', 'owl'),
    );
    expect(rows.map((r) => [r.slug, r.sortOrder])).toEqual([
      ['fawn', 10],
      ['owl', 20],
    ]);
  });

  it('defaults alt text to "title, medium" for a published entry without one', () => {
    const [row] = buildArtworkRows(parse(fawn), manifestWith('fawn'));
    expect(row!.altText).toBe('Fawn, scratchboard');
  });

  it('keeps written alt text, and leaves drafts without a default', () => {
    const rows = buildArtworkRows(
      parse({ ...fawn, altText: 'A fawn looking up' }, stubEntry('owl', 'owl.jpg')),
      manifestWith('fawn', 'owl'),
    );
    expect(rows.map((r) => r.altText)).toEqual(['A fawn looking up', null]);
  });

  it('turns tag names into slugs, ignoring accents', () => {
    const [row] = buildArtworkRows(
      parse({ ...fawn, tags: ['Animals', 'Guayasamín Studies'] }),
      manifestWith('fawn'),
    );
    expect(row!.tags).toEqual([
      { name: 'Animals', slug: 'animals' },
      { name: 'Guayasamín Studies', slug: 'guayasamin-studies' },
    ]);
  });

  it('changes the hash when anything about the artwork changes, and only then', () => {
    const hash = (entry: ArtworkEntryInput, manifest = manifestWith('fawn')) =>
      buildArtworkRows(parse(entry), manifest)[0]!.contentHash;

    const original = hash(fawn);
    expect(hash(fawn)).toBe(original);
    expect(hash({ ...fawn, title: 'Fawn II' })).not.toBe(original);
    expect(hash({ ...fawn, tags: ['Animals'] })).not.toBe(original);

    const reprocessed = manifestWith('fawn');
    reprocessed.artworks.fawn!.large.src = '/media/artworks/fawn.large.33333333.webp';
    expect(hash(fawn, reprocessed)).not.toBe(original);
  });

  it('reports every mismatch between the file and the images at once', () => {
    const err = contentError(() =>
      buildArtworkRows(
        parse(
          fawn,
          { ...fawn, image: 'owl' }, // duplicate slug
          { ...fawn, slug: 'fawn-copy' }, // duplicate image
          { ...fawn, image: 'gone', slug: 'gone' }, // image doesn't exist
          { ...fawn, image: 'bad-tag', slug: 'bad-tag', tags: ['!!!'] },
        ),
        manifestWith('fawn', 'owl', 'bad-tag', 'undescribed'),
      ),
    );

    expect(err.problems).toEqual(
      expect.arrayContaining([
        'slug "fawn" is used by more than one artwork',
        'image "fawn" is used by more than one artwork',
        expect.stringMatching(/image "undescribed" \(undescribed\.jpg\) has no entry/),
        expect.stringMatching(/artwork "gone" uses image "gone", which isn't in/),
        expect.stringMatching(/artwork "bad-tag" has a tag with no letters or digits/),
      ]),
    );
    expect(err.problems).toHaveLength(5);
  });
});
