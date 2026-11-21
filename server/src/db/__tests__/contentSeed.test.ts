import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pool } from '../pool.js';
import { seedContent } from '../seeds/content.ts';
import { CONTENT_DIR, MEDIA_DIR } from '../../config/paths.ts';
import { ContentError } from '../../lib/contentFile.ts';
import { truncateAllTables } from '../../../tests/setup/database.js';
import { createArtwork } from '../../../tests/factories/index.js';

// CONTENT_DIR and MEDIA_DIR point at tests/fixtures (vitest.config.js). Tests that edit
// content work on a copy in a temp folder.
let tmp: string;

beforeEach(async () => {
  await truncateAllTables();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'content-seed-'));
  await cp(CONTENT_DIR, path.join(tmp, 'content'), { recursive: true });
  await cp(MEDIA_DIR, path.join(tmp, 'media'), { recursive: true });
});

afterEach(() => rm(tmp, { recursive: true, force: true }));

const dirs = () => ({ contentDir: path.join(tmp, 'content'), mediaDir: path.join(tmp, 'media') });

async function editEntry(slug: string, changes: Record<string, unknown>) {
  const file = path.join(tmp, 'content', 'artworks.json');
  const content = JSON.parse(await readFile(file, 'utf8'));
  content.artworks = content.artworks.map((e: { slug: string }) =>
    e.slug === slug ? { ...e, ...changes } : e,
  );
  await writeFile(file, JSON.stringify(content));
}

async function artworks() {
  const { rows } = await pool.query(
    `SELECT a.slug, a.title, a.is_published, a.alt_text, a.content_hash IS NOT NULL AS managed,
            array_remove(array_agg(t.slug ORDER BY t.slug), NULL) AS tags
       FROM artworks a
       LEFT JOIN artwork_tags at ON at.artwork_id = a.id
       LEFT JOIN tags t ON t.id = at.tag_id
      GROUP BY a.id ORDER BY a.sort_order`,
  );
  return rows;
}

describe('seedContent', () => {
  it('inserts every entry, with tags, publishing state, and default alt text', async () => {
    const result = await seedContent(dirs());

    expect(result).toMatchObject({
      inserted: ['fawn', 'starry-night', 'draft-piece'],
      published: 2,
      drafts: 1,
      aboutIsPlaceholder: false,
    });
    expect(await artworks()).toEqual([
      {
        slug: 'fawn',
        title: 'Fawn',
        is_published: true,
        alt_text: 'Fawn, scratchboard',
        managed: true,
        tags: ['animals'],
      },
      {
        slug: 'starry-night',
        title: 'Starry Night',
        is_published: true,
        alt_text: 'A swirling night sky over a village',
        managed: true,
        tags: [],
      },
      {
        slug: 'draft-piece',
        title: 'draft-piece',
        is_published: false,
        alt_text: null,
        managed: true,
        tags: ['secret'],
      },
    ]);
  });

  it('changes nothing on a second run', async () => {
    await seedContent(dirs());
    const before = await pool.query('SELECT id, updated_at FROM artworks ORDER BY id');

    const result = await seedContent(dirs());

    expect(result).toMatchObject({ inserted: [], updated: [], removed: [], unchanged: 3 });
    expect((await pool.query('SELECT id, updated_at FROM artworks ORDER BY id')).rows).toEqual(
      before.rows,
    );
  });

  it('keeps an admin edit across restarts while the file entry is unchanged', async () => {
    await seedContent(dirs());
    await pool.query(`UPDATE artworks SET title = 'Edited by admin' WHERE slug = 'fawn'`);

    await seedContent(dirs());

    expect((await artworks())[0].title).toBe('Edited by admin');
  });

  it('lets the file win once its entry changes, including tags', async () => {
    await seedContent(dirs());
    await pool.query(`UPDATE artworks SET title = 'Edited by admin' WHERE slug = 'fawn'`);
    await editEntry('fawn', { title: 'Fawn at Dusk', tags: ['Night'] });

    const result = await seedContent(dirs());

    expect(result.updated).toEqual(['fawn']);
    expect((await artworks())[0]).toMatchObject({ title: 'Fawn at Dusk', tags: ['night'] });
  });

  it('publishes a draft once it is filled in', async () => {
    await seedContent(dirs());
    await editEntry('draft-piece', {
      title: 'Hidden Garden',
      category: 'nature',
      medium: 'ink',
      published: true,
    });

    await seedContent(dirs());

    expect((await artworks())[2]).toMatchObject({
      title: 'Hidden Garden',
      is_published: true,
      alt_text: 'Hidden Garden, ink',
    });
  });

  it('deletes a file-owned artwork whose entry and image were removed, but not API-created ones', async () => {
    await seedContent(dirs());
    const apiCreated = await createArtwork({ slug: 'from-the-api' });
    const file = path.join(tmp, 'content', 'artworks.json');
    const content = JSON.parse(await readFile(file, 'utf8'));
    content.artworks = content.artworks.filter((e: { slug: string }) => e.slug !== 'fawn');
    await writeFile(file, JSON.stringify(content));
    const manifestFile = path.join(tmp, 'media', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    delete manifest.artworks.fawn;
    await writeFile(manifestFile, JSON.stringify(manifest));

    const result = await seedContent(dirs());

    expect(result.removed).toEqual(['fawn']);
    const slugs = (await pool.query('SELECT slug FROM artworks ORDER BY id')).rows.map(
      (r) => r.slug,
    );
    expect(slugs).toEqual(['starry-night', 'draft-piece', apiCreated.slug]);
  });

  it('refuses, changing nothing, when an image has no entry', async () => {
    await editEntry('fawn', { image: 'study', slug: 'fawn' }); // fawn's image now undescribed

    await expect(seedContent(dirs())).rejects.toThrow(ContentError);
    expect(await artworks()).toEqual([]);
  });

  it('refuses when the manifest lists an image file that is not on disk', async () => {
    await rm(path.join(tmp, 'media', 'artworks', 'fawn.large.22222222.webp'));

    await expect(seedContent(dirs())).rejects.toThrow(/missing \(commit media\/\)/);
  });

  it('refuses when an API-created artwork already uses an image from the file', async () => {
    await createArtwork({ imageKey: 'fawn', slug: 'api-fawn' });

    await expect(seedContent(dirs())).rejects.toThrow(/already used by artworks created through/);
  });

  it('refuses, rolling back everything, when a file slug collides with an API-created artwork', async () => {
    await createArtwork({ slug: 'starry-night' });

    await expect(seedContent(dirs())).rejects.toThrow(/Slug "starry-night" is already used/);
    expect((await pool.query('SELECT count(*)::int AS n FROM artworks')).rows[0].n).toBe(1);
  });

  it('refuses an About page whose photo is not in the manifest', async () => {
    await writeFile(
      path.join(tmp, 'content', 'about.json'),
      JSON.stringify({ photo: 'nobody', photoAlt: 'x', bio: ['x'] }),
    );

    await expect(seedContent(dirs())).rejects.toThrow(/photo "nobody" isn't in/);
  });
});
