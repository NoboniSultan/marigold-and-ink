import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { seedContent } from '../../../db/seeds/content.ts';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createArtwork, createTag, tagArtwork } from '../../../../tests/factories/index.js';
import { loggedInAgent, TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';

// Fixture content (tests/fixtures): "fawn" (published, tag Animals), "starry-night"
// (published, credit "after Vincent van Gogh"), "draft-piece" (unpublished, tag Secret).
const app = createApp();

beforeEach(truncateAllTables);

const titles = (res: request.Response) => res.body.data.map((a: { title: string }) => a.title);

async function admin() {
  return (await loggedInAgent(app, { role: 'admin' })).agent;
}

describe('GET /api/v1/artworks (public)', () => {
  beforeEach(() => seedContent());

  it('lists only published artworks, in gallery order, with images and tags', async () => {
    const res = await request(app).get('/api/v1/artworks');

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['Fawn', 'Starry Night']);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 2 });
    expect(res.body.data[0]).toEqual({
      id: expect.any(Number),
      slug: 'fawn',
      title: 'Fawn',
      description: null,
      medium: 'scratchboard',
      category: 'nature',
      year: null,
      credit: null,
      image: {
        thumb: { src: '/media/artworks/fawn.thumb.11111111.webp', width: 6, height: 8 },
        large: { src: '/media/artworks/fawn.large.22222222.webp', width: 12, height: 16 },
        alt: 'Fawn, scratchboard',
      },
      tags: [{ id: expect.any(Number), name: 'Animals', slug: 'animals' }],
    });
  });

  it('never exposes admin-only fields', async () => {
    const res = await request(app).get('/api/v1/artworks');

    for (const field of ['isPublished', 'contentManaged', 'imageKey', 'sortOrder', 'contentHash']) {
      expect(res.body.data[0]).not.toHaveProperty(field);
    }
  });

  it('paginates', async () => {
    const res = await request(app).get('/api/v1/artworks?page=2&pageSize=1');

    expect(titles(res)).toEqual(['Starry Night']);
    expect(res.body.meta).toEqual({ page: 2, pageSize: 1, total: 2 });
  });

  it('still reports the real total on a page past the end (filters applied)', async () => {
    const all = await request(app).get('/api/v1/artworks?page=99');
    const tagged = await request(app).get('/api/v1/artworks?tag=animals&page=99');

    expect(all.body.data).toEqual([]);
    expect(all.body.meta).toEqual({ page: 99, pageSize: 20, total: 2 });
    expect(tagged.body.meta.total).toBe(1);
  });

  it('filters by category', async () => {
    const res = await request(app).get('/api/v1/artworks?category=studies');
    expect(titles(res)).toEqual(['Starry Night']);
  });

  it('filters by tag, without leaking drafts that carry the tag', async () => {
    expect(titles(await request(app).get('/api/v1/artworks?tag=animals'))).toEqual(['Fawn']);
    expect(titles(await request(app).get('/api/v1/artworks?tag=secret'))).toEqual([]);
  });

  it('ignores accents in both directions', async () => {
    await createArtwork({
      title: 'Embrace',
      credit: 'after Oswaldo Guayasamín',
      isPublished: true,
    });

    expect(titles(await request(app).get('/api/v1/artworks?q=guayasamin'))).toEqual(['Embrace']);
    expect(titles(await request(app).get('/api/v1/artworks?q=Guayasamín'))).toEqual(['Embrace']);
    expect(titles(await request(app).get('/api/v1/artworks?q=embráce'))).toEqual(['Embrace']);
  });

  it('searches title, credit, and medium, with stemming', async () => {
    expect(titles(await request(app).get('/api/v1/artworks?q=gogh'))).toEqual(['Starry Night']);
    expect(titles(await request(app).get('/api/v1/artworks?q=nights'))).toEqual(['Starry Night']);
    expect(titles(await request(app).get('/api/v1/artworks?q=scratchboard'))).toEqual([
      'Fawn',
      'Starry Night',
    ]);
  });

  it('ranks title matches above other matches', async () => {
    await createArtwork({
      title: 'Evening Study',
      medium: 'ink, after a starry sky',
      isPublished: true,
      sortOrder: 0,
    });

    const res = await request(app).get('/api/v1/artworks?q=starry');

    expect(titles(res)).toEqual(['Starry Night', 'Evening Study']);
  });

  it('accepts search syntax that would break a naive query', async () => {
    const res = await request(app).get('/api/v1/artworks').query({ q: `"starry night" -fawn & |` });

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['Starry Night']);
  });

  it('does not find drafts by search', async () => {
    expect(titles(await request(app).get('/api/v1/artworks?q=draft'))).toEqual([]);
  });

  it('rejects invalid filters', async () => {
    const res = await request(app).get('/api/v1/artworks?tag=Not%20A%20Slug&pageSize=500');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'pageSize',
      'tag',
    ]);
  });
});

describe('GET /api/v1/artworks/:slug (public)', () => {
  beforeEach(() => seedContent());

  it('returns a published artwork', async () => {
    const res = await request(app).get('/api/v1/artworks/starry-night');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: 'Starry Night',
      credit: 'after Vincent van Gogh',
      image: { alt: 'A swirling night sky over a village' },
    });
  });

  it('answers 404 for a draft, exactly as for a missing artwork', async () => {
    const draft = await request(app).get('/api/v1/artworks/draft-piece');
    const missing = await request(app).get('/api/v1/artworks/no-such-art');

    expect(draft.status).toBe(404);
    expect(draft.body).toEqual(missing.body);
    expect(draft.body.error.code).toBe('ARTWORK_NOT_FOUND');
  });

  it('rejects a malformed slug', async () => {
    expect((await request(app).get('/api/v1/artworks/Bad%20Slug')).status).toBe(400);
  });
});

describe('GET /api/v1/artworks/categories and /api/v1/tags (public)', () => {
  beforeEach(() => seedContent());

  it('counts published artworks per category, ignoring drafts', async () => {
    const res = await request(app).get('/api/v1/artworks/categories');

    expect(res.body.data).toEqual([
      { category: 'nature', count: 1 },
      { category: 'studies', count: 1 },
    ]);
  });

  it('lists only tags used by published artworks', async () => {
    await createTag({ name: 'Unused', slug: 'unused' });

    const res = await request(app).get('/api/v1/tags');

    expect(res.body.data).toEqual([
      { id: expect.any(Number), name: 'Animals', slug: 'animals', count: 1 },
    ]);
  });
});

describe('/media (processed images)', () => {
  it('serves images with long-lived caching and no session cookie', async () => {
    const res = await request(app).get('/media/artworks/fawn.thumb.11111111.webp');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('does not expose the manifest, and 404s a missing image as JSON', async () => {
    const manifest = await request(app).get('/media/manifest.json');
    const missing = await request(app).get('/media/artworks/nope.webp');

    expect(manifest.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('blocks path traversal out of the media folder', async () => {
    const res = await request(app).get('/media/artworks/..%2f..%2fmanifest.json');

    expect(res.status).toBe(404);
  });
});

describe('admin routes: authentication and role', () => {
  const routes: [string, string][] = [
    ['get', '/api/v1/admin/artworks'],
    ['get', '/api/v1/admin/artworks/1'],
    ['post', '/api/v1/admin/artworks'],
    ['patch', '/api/v1/admin/artworks/1'],
    ['delete', '/api/v1/admin/artworks/1'],
    ['get', '/api/v1/admin/tags'],
    ['post', '/api/v1/admin/tags'],
    ['patch', '/api/v1/admin/tags/1'],
    ['delete', '/api/v1/admin/tags/1'],
  ];

  it.each(routes)('%s %s needs a login (401)', async (method, url) => {
    const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[
      method
    ]!(url).set('Origin', TRUSTED_ORIGIN);
    expect(res.status).toBe(401);
  });

  it.each(routes)('%s %s is admin-only (403 for a client)', async (method, url) => {
    const { agent } = await loggedInAgent(app, { role: 'client' });
    const res = await (agent as unknown as Record<string, (u: string) => request.Test>)[method]!(
      url,
    ).set('Origin', TRUSTED_ORIGIN);
    expect(res.status).toBe(403);
  });

  it('applies the CSRF origin check to admin writes', async () => {
    const agent = await admin();

    const res = await agent.post('/api/v1/admin/tags').set('Origin', 'https://evil.example').send({
      name: 'X',
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
  });
});

describe('GET /api/v1/admin/artworks', () => {
  beforeEach(() => seedContent());

  it('includes drafts and admin fields', async () => {
    const res = await (await admin()).get('/api/v1/admin/artworks');

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['Fawn', 'Starry Night', 'draft-piece']);
    expect(res.body.data[2]).toMatchObject({
      isPublished: false,
      contentManaged: true,
      imageKey: 'draft-piece',
      image: { alt: null },
    });
  });

  it('filters by status', async () => {
    const agent = await admin();
    expect(titles(await agent.get('/api/v1/admin/artworks?status=draft'))).toEqual(['draft-piece']);
    expect(titles(await agent.get('/api/v1/admin/artworks?status=published'))).toHaveLength(2);
    expect((await agent.get('/api/v1/admin/artworks?status=hidden')).status).toBe(400);
  });

  it('gets one artwork by id, 404 for a missing one, 400 for a bad id', async () => {
    const agent = await admin();
    const { rows } = await pool.query(`SELECT id FROM artworks WHERE slug = 'draft-piece'`);

    expect((await agent.get(`/api/v1/admin/artworks/${rows[0].id}`)).body.data.slug).toBe(
      'draft-piece',
    );
    expect((await agent.get('/api/v1/admin/artworks/999999')).status).toBe(404);
    expect((await agent.get('/api/v1/admin/artworks/abc')).status).toBe(400);
  });
});

describe('POST /api/v1/admin/artworks', () => {
  const valid = {
    imageKey: 'fawn',
    slug: 'fawn',
    title: 'Fawn',
    category: 'nature',
    altText: 'A fawn',
    isPublished: true,
    tags: ['Animals', 'animals', 'Forest'],
  };

  it('creates an artwork from a processed image', async () => {
    const res = await (
      await admin()
    )
      .post('/api/v1/admin/artworks')
      .set('Origin', TRUSTED_ORIGIN)
      .send(valid);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      slug: 'fawn',
      isPublished: true,
      contentManaged: false,
      image: { thumb: { src: '/media/artworks/fawn.thumb.11111111.webp' }, alt: 'A fawn' },
      // Duplicate names collapse to one tag.
      tags: [
        { name: 'Animals', slug: 'animals' },
        { name: 'Forest', slug: 'forest' },
      ],
    });
    expect((await request(app).get('/api/v1/artworks/fawn')).status).toBe(200);
  });

  it('rejects an invalid body (400), including unknown fields', async () => {
    const res = await (
      await admin()
    )
      .post('/api/v1/admin/artworks')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ ...valid, title: '', priceCents: 100 });

    expect(res.status).toBe(400);
  });

  it('refuses an image that was never processed (422)', async () => {
    const res = await (
      await admin()
    )
      .post('/api/v1/admin/artworks')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ ...valid, imageKey: 'not-processed' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IMAGE_NOT_FOUND');
  });

  it('refuses publishing without alt text (422)', async () => {
    const res = await (
      await admin()
    )
      .post('/api/v1/admin/artworks')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ ...valid, altText: null });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ALT_TEXT_REQUIRED');
  });

  it.each([
    ['an image already in use', { slug: 'other' }, 'IMAGE_IN_USE'],
    ['a slug already in use', { imageKey: 'study' }, 'SLUG_TAKEN'],
  ])('refuses %s (409)', async (_label, change, code) => {
    const agent = await admin();
    await agent.post('/api/v1/admin/artworks').set('Origin', TRUSTED_ORIGIN).send(valid);

    const res = await agent
      .post('/api/v1/admin/artworks')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ ...valid, ...change });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(code);
  });
});

describe('PATCH /api/v1/admin/artworks/:id', () => {
  async function draftId() {
    await seedContent();
    const { rows } = await pool.query(`SELECT id FROM artworks WHERE slug = 'draft-piece'`);
    return rows[0].id as number;
  }

  it('edits fields and replaces tags', async () => {
    const id = await draftId();

    const res = await (
      await admin()
    )
      .patch(`/api/v1/admin/artworks/${id}`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ title: 'Hidden Garden', year: 2024, tags: ['Garden'] });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: 'Hidden Garden',
      year: 2024,
      tags: [{ name: 'Garden', slug: 'garden' }],
    });
  });

  it('refuses to publish a draft that has no alt text (422), and allows it once added', async () => {
    const id = await draftId();
    const agent = await admin();
    const publish = (body: object) =>
      agent.patch(`/api/v1/admin/artworks/${id}`).set('Origin', TRUSTED_ORIGIN).send(body);

    expect((await publish({ isPublished: true })).body.error.code).toBe('ALT_TEXT_REQUIRED');
    expect((await publish({ isPublished: true, altText: 'A walled garden' })).status).toBe(200);
  });

  it('refuses to clear the alt text of a published artwork (422)', async () => {
    await seedContent();
    const { rows } = await pool.query(`SELECT id FROM artworks WHERE slug = 'fawn'`);

    const res = await (
      await admin()
    )
      .patch(`/api/v1/admin/artworks/${rows[0].id}`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ altText: null });

    expect(res.status).toBe(422);
  });

  it('refuses a slug that is taken (409), an empty body (400), and a missing id (404)', async () => {
    const id = await draftId();
    const agent = await admin();
    const patch = (url: string, body: object) =>
      agent.patch(url).set('Origin', TRUSTED_ORIGIN).send(body);

    expect((await patch(`/api/v1/admin/artworks/${id}`, { slug: 'fawn' })).body.error.code).toBe(
      'SLUG_TAKEN',
    );
    expect((await patch(`/api/v1/admin/artworks/${id}`, {})).status).toBe(400);
    expect((await patch('/api/v1/admin/artworks/999999', { title: 'X' })).status).toBe(404);
  });
});

describe('DELETE /api/v1/admin/artworks/:id', () => {
  it('deletes an API-created artwork and its tag links', async () => {
    const artwork = await createArtwork();
    const tag = await createTag();
    await tagArtwork(artwork.id, tag.id);

    const res = await (
      await admin()
    )
      .delete(`/api/v1/admin/artworks/${artwork.id}`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(res.status).toBe(204);
    expect((await pool.query('SELECT count(*)::int AS n FROM artwork_tags')).rows[0].n).toBe(0);
  });

  it('refuses to delete an artwork owned by content/artworks.json (409)', async () => {
    await seedContent();
    const { rows } = await pool.query(`SELECT id FROM artworks WHERE slug = 'fawn'`);

    const res = await (
      await admin()
    )
      .delete(`/api/v1/admin/artworks/${rows[0].id}`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ARTWORK_CONTENT_MANAGED');
  });

  it('answers 404 for a missing artwork and 400 for a bad id', async () => {
    const agent = await admin();
    const del = (id: string) =>
      agent.delete(`/api/v1/admin/artworks/${id}`).set('Origin', TRUSTED_ORIGIN);

    expect((await del('999999')).status).toBe(404);
    expect((await del('abc')).status).toBe(400);
  });
});

describe('admin tags', () => {
  it('creates a tag, deriving the slug from the name', async () => {
    const res = await (
      await admin()
    )
      .post('/api/v1/admin/tags')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ name: 'Guayasamín Studies' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Guayasamín Studies', slug: 'guayasamin-studies' });
  });

  it('refuses a duplicate slug (409) and a name with no letters (422)', async () => {
    const agent = await admin();
    const post = (body: object) =>
      agent.post('/api/v1/admin/tags').set('Origin', TRUSTED_ORIGIN).send(body);
    await post({ name: 'Pets' });

    expect((await post({ name: 'pets!' })).body.error.code).toBe('TAG_TAKEN');
    expect((await post({ name: '!!!' })).body.error.code).toBe('INVALID_TAG');
    expect((await post({})).status).toBe(400);
  });

  it('lists every tag with its use count, including unused ones', async () => {
    const used = await createTag({ name: 'Used', slug: 'used' });
    await createTag({ name: 'Unused', slug: 'unused' });
    await tagArtwork((await createArtwork()).id, used.id);

    const res = await (await admin()).get('/api/v1/admin/tags');

    expect(res.body.data.map((t: { slug: string; count: number }) => [t.slug, t.count])).toEqual([
      ['unused', 0],
      ['used', 1],
    ]);
  });

  it('renames a tag, or answers 404', async () => {
    const tag = await createTag();
    const agent = await admin();
    const patch = (id: number) =>
      agent
        .patch(`/api/v1/admin/tags/${id}`)
        .set('Origin', TRUSTED_ORIGIN)
        .send({ name: 'Renamed' });

    expect((await patch(tag.id)).body.data).toMatchObject({ name: 'Renamed', slug: tag.slug });
    expect((await patch(999999)).status).toBe(404);
  });

  it('rejects an invalid rename (400)', async () => {
    const tag = await createTag();
    const patch = async (body: object) =>
      (await admin())
        .patch(`/api/v1/admin/tags/${tag.id}`)
        .set('Origin', TRUSTED_ORIGIN)
        .send(body);

    for (const body of [{}, { name: '' }, { name: 42 }]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('deletes a tag, or answers 404', async () => {
    const tag = await createTag();
    const agent = await admin();
    const del = (id: number) =>
      agent.delete(`/api/v1/admin/tags/${id}`).set('Origin', TRUSTED_ORIGIN);

    expect((await del(tag.id)).status).toBe(204);
    expect((await del(tag.id)).status).toBe(404);
  });
});
