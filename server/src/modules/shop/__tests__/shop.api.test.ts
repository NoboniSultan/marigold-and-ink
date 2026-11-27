/** The shop catalog (milestone 12a): the public shop and the admin's product management. */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  createProduct,
  createProductPhoto,
  createVariant,
} from '../../../../tests/factories/index.js';
import { loggedInAgent, TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';
import { fakeStorage } from '../../../../tests/helpers/storage.ts';
import { jpegWithExif, PDF } from '../../../../tests/helpers/images.ts';

type Agent = ReturnType<typeof request.agent>;
type AnyAgent = Agent | ReturnType<typeof request>;

let storage: ReturnType<typeof fakeStorage>;

beforeEach(async () => {
  await truncateAllTables();
  storage = fakeStorage();
});

const appWith = (shopOpen: boolean) =>
  createApp({
    adapters: { email: null, google: null, payments: null, storage: storage.storage },
    shopOpen,
  });

/** A published product: one option, one photo with alt text. */
async function publishedProduct(overrides: Record<string, unknown> = {}) {
  const product = await createProduct({ published: true, ...overrides });
  const variant = await createVariant({ productId: product.id, name: 'Single', priceCents: 400 });
  const photo = await createProductPhoto({ productId: product.id, altText: 'Three stickers' });
  return { product, variant, photo };
}

const admin = (app: ReturnType<typeof createApp>) => loggedInAgent(app, { role: 'admin' });
const base = '/api/v1/admin/shop';
const send = (agent: AnyAgent, method: 'post' | 'patch' | 'put' | 'delete', url: string) =>
  agent[method](url).set('Origin', TRUSTED_ORIGIN);

describe('the shop before it opens', () => {
  it('says it is closed, and shows visitors and clients nothing', async () => {
    const app = appWith(false);
    const { product } = await publishedProduct();
    const client = await loggedInAgent(app);

    expect((await request(app).get('/api/v1/shop')).body).toEqual({ data: { open: false } });
    for (const agent of [request(app), client.agent]) {
      const list = await agent.get('/api/v1/shop/products');
      expect(list.status).toBe(404);
      expect(list.body.error.code).toBe('SHOP_CLOSED');
      expect((await agent.get(`/api/v1/shop/products/${product.slug}`)).status).toBe(404);
    }
  });

  it('lets the admin preview it, unpublished products included', async () => {
    const app = appWith(false);
    const { product } = await publishedProduct();
    const draft = await createProduct({ name: 'Draft vase' });
    const { agent } = await admin(app);

    const list = await agent.get('/api/v1/shop/products');
    expect(list.status).toBe(200);
    expect(list.body.data.map((p: { slug: string }) => p.slug)).toEqual([product.slug]);
    expect((await agent.get(`/api/v1/shop/products/${draft.slug}`)).status).toBe(200);
  });
});

describe('the open shop', () => {
  it('lists published products with their price, availability, and cover photo', async () => {
    const app = appWith(true);
    const { product, photo } = await publishedProduct({ category: 'stickers' });
    await createVariant({ productId: product.id, name: 'Pack of 5', priceCents: 1500, stock: 0 });
    await createProduct({ name: 'Not yet' }); // unpublished

    const res = await request(app).get('/api/v1/shop/products');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [
        {
          slug: product.slug,
          name: product.name,
          category: 'stickers',
          priceFromCents: 400,
          priceToCents: 1500,
          available: true,
          oneOfAKind: false,
          photo: {
            id: Number(photo.id),
            smallUrl: `/media/${photo.small_key}`,
            largeUrl: `/media/${photo.large_key}`,
            width: 1600,
            height: 1200,
            altText: 'Three stickers',
          },
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });

  it('filters by category and validates it', async () => {
    const app = appWith(true);
    await publishedProduct({ category: 'cards' });
    const { product } = await publishedProduct({ category: 'jewelry' });

    const res = await request(app).get('/api/v1/shop/products?category=jewelry');
    expect(res.body.data.map((p: { slug: string }) => p.slug)).toEqual([product.slug]);
    expect((await request(app).get('/api/v1/shop/products?category=furniture')).status).toBe(400);
  });

  it("shows a product's page with its options and photos, never its stock count", async () => {
    const app = appWith(true);
    const { product, variant } = await publishedProduct({
      description: 'Glossy vinyl.',
      materials: 'Vinyl',
    });
    await createVariant({ productId: product.id, name: 'Pack of 5', priceCents: 1500, stock: 0 });

    const res = await request(app).get(`/api/v1/shop/products/${product.slug}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      description: 'Glossy vinyl.',
      materials: 'Vinyl',
      dimensions: null,
      variants: [
        { id: Number(variant.id), name: 'Single', priceCents: 400, available: true },
        { name: 'Pack of 5', priceCents: 1500, available: false },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain('stock');
  });

  it('marks a sold one-of-a-kind piece unavailable, and hides unpublished ones', async () => {
    const app = appWith(true);
    const vase = await createProduct({ published: true, oneOfAKind: true, category: 'upcycled' });
    await createVariant({ productId: vase.id, name: 'One of a kind', priceCents: 9000, stock: 0 });
    await createProductPhoto({ productId: vase.id });
    const draft = await createProduct();

    const res = await request(app).get(`/api/v1/shop/products/${vase.slug}`);
    expect(res.body.data).toMatchObject({ oneOfAKind: true, available: false });
    expect((await request(app).get(`/api/v1/shop/products/${draft.slug}`)).status).toBe(404);
    expect((await request(app).get('/api/v1/shop/products/no-such-thing')).status).toBe(404);
  });
});

describe('product photos at /media/shop/products', () => {
  it('serves a stored photo, cached forever', async () => {
    const app = appWith(true);
    const key = 'shop/products/5/0123456789abcdef-small.webp';
    storage.objects.set(key, { body: Buffer.from('webp bytes'), contentType: 'image/webp' });

    const res = await request(app).get(`/media/${key}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.body.toString()).toBe('webp bytes');
  });

  it('answers 404 for anything else, and when storage is off', async () => {
    const app = appWith(true);
    storage.objects.set('commissions/1/reference/x.jpg', {
      body: Buffer.from('private'),
      contentType: 'image/jpeg',
    });
    for (const url of [
      '/media/shop/products/5/0123456789abcdef-small.webp', // not stored
      '/media/shop/products/5/x.jpg',
      '/media/shop/products/..%2F..%2Fcommissions/1',
    ]) {
      expect((await request(app).get(url)).status).toBe(404);
    }
    const off = createApp({ adapters: { email: null, google: null, payments: null } });
    expect(
      (await request(off).get('/media/shop/products/5/0123456789abcdef-small.webp')).status,
    ).toBe(404);
  });
});

describe('admin: products', () => {
  it('creates an unpublished product, with a web address from its name', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);

    const res = await send(agent, 'post', `${base}/products`).send({
      name: 'Marigold Earrings',
      category: 'jewelry',
      description: 'PLACEHOLDER: description',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      slug: 'marigold-earrings',
      name: 'Marigold Earrings',
      category: 'jewelry',
      materials: null,
      oneOfAKind: false,
      published: false,
      variants: [],
      photos: [],
      stock: 0,
      missing: ['variant', 'photo'],
    });
  });

  it('refuses a taken web address, and a name with no letters or numbers', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    await createProduct({ slug: 'cards' });
    const taken = await send(agent, 'post', `${base}/products`).send({
      name: 'Cards',
      category: 'cards',
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('PRODUCT_SLUG_TAKEN');
    const empty = await send(agent, 'post', `${base}/products`).send({
      name: '✿✿✿',
      category: 'cards',
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('PRODUCT_SLUG_REQUIRED');
  });

  it('validates the fields', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    for (const body of [
      {},
      { name: 'X', category: 'furniture' },
      { name: 'X', category: 'cards', slug: 'Not A Slug' },
      { name: 'X', category: 'cards', price: 5 },
    ]) {
      expect((await send(agent, 'post', `${base}/products`).send(body)).status).toBe(400);
    }
  });

  it('is admin only', async () => {
    const app = appWith(true);
    const client = await loggedInAgent(app);
    const product = await createProduct();
    expect((await request(app).get(`${base}/products`)).status).toBe(401);
    expect((await client.agent.get(`${base}/products`)).status).toBe(403);
    expect(
      (await send(client.agent, 'patch', `${base}/products/${product.id}`).send({ name: 'Y' }))
        .status,
    ).toBe(403);
  });

  it('lists every product, drafts included, with stock totals', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const { product } = await publishedProduct();
    await createVariant({ productId: product.id, name: 'Pack', stock: 4 });
    await createProduct({ category: 'cards' });

    const res = await agent.get(`${base}/products`);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data.find((p: { id: number }) => p.id === Number(product.id))).toMatchObject({
      stock: 7,
      published: true,
      missing: [],
    });
    expect((await agent.get(`${base}/products?category=cards`)).body.meta.total).toBe(1);
  });

  it('publishes only a complete product, and keeps a published one complete', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const product = await createProduct();
    const publish = () =>
      send(agent, 'patch', `${base}/products/${product.id}`).send({ published: true });

    let res = await publish();
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'PRODUCT_INCOMPLETE',
      details: { missing: ['variant', 'photo'] },
    });

    const variant = await createVariant({ productId: product.id });
    const photo = await createProductPhoto({ productId: product.id, altText: null });
    expect((await publish()).body.error.details.missing).toEqual(['alt_text']);
    await send(agent, 'patch', `${base}/photos/${photo.id}`).send({ altText: 'A sticker sheet' });
    res = await publish();
    expect(res.status).toBe(200);
    expect(res.body.data.published).toBe(true);

    // While published, removing what it needs is refused.
    for (const attempt of [
      send(agent, 'delete', `${base}/variants/${variant.id}`),
      send(agent, 'delete', `${base}/photos/${photo.id}`),
      send(agent, 'patch', `${base}/photos/${photo.id}`).send({ altText: '' }),
    ]) {
      const refused = await attempt;
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('PRODUCT_INCOMPLETE');
    }
  });

  it('edits fields, clearing optional ones with null', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const product = await createProduct({ materials: 'Glass' });

    const res = await send(agent, 'patch', `${base}/products/${product.id}`).send({
      name: 'Blue Vase',
      slug: 'blue-vase',
      materials: null,
      dimensions: '20 cm tall',
    });
    expect(res.body.data).toMatchObject({
      name: 'Blue Vase',
      slug: 'blue-vase',
      materials: null,
      dimensions: '20 cm tall',
    });
    expect((await send(agent, 'patch', `${base}/products/${product.id}`).send({})).status).toBe(
      400,
    );
    expect((await send(agent, 'patch', `${base}/products/99999`).send({ name: 'X' })).status).toBe(
      404,
    );
  });

  it('deletes a product with its options, photos, and stored files', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const { product, photo } = await publishedProduct();
    storage.objects.set(photo.small_key, { body: Buffer.from('s'), contentType: 'image/webp' });
    storage.objects.set(photo.large_key, { body: Buffer.from('l'), contentType: 'image/webp' });

    expect((await send(agent, 'delete', `${base}/products/${product.id}`)).status).toBe(204);
    expect(storage.objects.size).toBe(0);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM product_variants');
    expect(rows[0].n).toBe(0);
    expect((await send(agent, 'delete', `${base}/products/${product.id}`)).status).toBe(404);
  });
});

describe('admin: options and stock', () => {
  it('adds an option with its starting stock, logged as a restock', async () => {
    const app = appWith(false);
    const { agent, user } = await admin(app);
    const product = await createProduct();

    const res = await send(agent, 'post', `${base}/products/${product.id}/variants`).send({
      name: 'Pack of 5',
      priceCents: 1500,
      stock: 12,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.variants).toEqual([
      { id: expect.any(Number), name: 'Pack of 5', priceCents: 1500, available: true, stock: 12 },
    ]);
    const { rows } = await pool.query(
      'SELECT change, stock_after, reason, actor_user_id FROM inventory_movements',
    );
    expect(rows).toEqual([
      { change: 12, stock_after: 12, reason: 'restock', actor_user_id: user.id },
    ]);
  });

  it('refuses a repeated name, a zero price, and negative stock', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const variant = await createVariant({ name: 'Single' });
    const add = (body: object) =>
      send(agent, 'post', `${base}/products/${variant.product_id}/variants`).send(body);

    const repeated = await add({ name: 'Single', priceCents: 100, stock: 1 });
    expect(repeated.status).toBe(409);
    expect(repeated.body.error.code).toBe('VARIANT_NAME_TAKEN');
    expect((await add({ name: 'B', priceCents: 0, stock: 1 })).status).toBe(400);
    expect((await add({ name: 'B', priceCents: 1.5, stock: 1 })).status).toBe(400);
    expect((await add({ name: 'B', priceCents: 100, stock: -1 })).status).toBe(400);
  });

  it('renames and reprices an option', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const variant = await createVariant({ name: 'Single', priceCents: 400 });

    const res = await send(agent, 'patch', `${base}/variants/${variant.id}`).send({
      priceCents: 450,
    });
    expect(res.body.data.variants[0]).toMatchObject({ name: 'Single', priceCents: 450 });
    expect((await send(agent, 'patch', `${base}/variants/99999`).send({ name: 'X' })).status).toBe(
      404,
    );
  });

  it('sets stock to a new count and logs the change with its reason', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const variant = await createVariant({ stock: 3 });
    const setStock = (body: object) =>
      send(agent, 'put', `${base}/variants/${variant.id}/stock`).send(body);

    expect((await setStock({ stock: 10, reason: 'restock' })).body.data.stock).toBe(10);
    await setStock({ stock: 9, reason: 'adjustment', note: 'One damaged' });
    await setStock({ stock: 9, reason: 'adjustment' }); // no change: no log row

    const res = await agent.get(`${base}/variants/${variant.id}/movements`);
    expect(res.body.data).toEqual([
      {
        change: -1,
        stockAfter: 9,
        reason: 'adjustment',
        note: 'One damaged',
        createdAt: expect.any(String),
      },
      { change: 7, stockAfter: 10, reason: 'restock', note: null, createdAt: expect.any(String) },
    ]);
    expect((await setStock({ stock: 5, reason: 'sale' })).status).toBe(400); // checkout only
  });

  it('keeps a one-of-a-kind piece to one option with a stock of 0 or 1', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const vase = await createProduct({ oneOfAKind: true, category: 'upcycled' });
    const add = (name: string, stock: number) =>
      send(agent, 'post', `${base}/products/${vase.id}/variants`).send({
        name,
        priceCents: 9000,
        stock,
      });

    const tooMany = await add('Vase', 2);
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.code).toBe('ONE_OF_A_KIND');
    expect((await add('Vase', 1)).status).toBe(201);
    expect((await add('Another', 0)).body.error.code).toBe('ONE_OF_A_KIND');

    // Turning a product with stock 4 into a one-of-a-kind piece is refused too.
    const stickers = await createVariant({ stock: 4 });
    const res = await send(agent, 'patch', `${base}/products/${stickers.product_id}`).send({
      oneOfAKind: true,
    });
    expect(res.body.error.code).toBe('ONE_OF_A_KIND');
  });

  it('deletes an option with its stock log', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const variant = await createVariant();
    await send(agent, 'put', `${base}/variants/${variant.id}/stock`).send({
      stock: 8,
      reason: 'restock',
    });

    const res = await send(agent, 'delete', `${base}/variants/${variant.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.variants).toEqual([]);
    expect((await agent.get(`${base}/variants/${variant.id}/movements`)).status).toBe(404);
  });
});

describe('admin: photos', () => {
  const upload = (agent: AnyAgent, productId: number, body: Buffer) =>
    send(agent, 'post', `${base}/products/${productId}/photos`)
      .set('Content-Type', 'application/octet-stream')
      .send(body);

  it('processes and stores a photo in two WebP sizes, with no metadata', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const product = await createProduct();

    const res = await upload(agent, product.id, await jpegWithExif(2400, 1800));

    expect(res.status).toBe(201);
    const [photo] = res.body.data.photos;
    expect(photo).toMatchObject({ width: 1600, height: 1200, altText: null });
    expect(photo.smallUrl).toMatch(
      new RegExp(`^/media/shop/products/${product.id}/[a-f0-9]{16}-small\\.webp$`),
    );
    const stored = storage.objects.get(photo.largeUrl.replace('/media/', ''))!;
    expect(stored.contentType).toBe('image/webp');
    const meta = await sharp(stored.body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(res.body.data.missing).toEqual(['variant', 'alt_text']);

    // The site serves it.
    const served = await request(app).get(photo.smallUrl);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
  });

  it('refuses files that are not JPEG, PNG, or WebP, and the same photo twice', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const product = await createProduct();

    const pdf = await upload(agent, product.id, PDF);
    expect(pdf.status).toBe(400);
    expect(pdf.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    const broken = await upload(agent, product.id, Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]));
    expect(broken.body.error.code).toBe('NOT_AN_IMAGE');

    const photo = await jpegWithExif();
    expect((await upload(agent, product.id, photo)).status).toBe(201);
    const again = await upload(agent, product.id, photo);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PHOTO_DUPLICATE');
    expect(storage.objects.size).toBe(2); // the first photo's two sizes stay
  });

  it('allows at most 10 photos, removing the stored files of a refused one', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const product = await createProduct();
    for (let i = 0; i < 10; i += 1) await createProductPhoto({ productId: product.id });

    const res = await upload(agent, product.id, await jpegWithExif());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PHOTO_LIMIT');
    expect(storage.objects.size).toBe(0);
  });

  it('answers 503 without storage, 404 for an unknown product, and is admin only', async () => {
    const off = createApp({ adapters: { email: null, google: null, payments: null } });
    const offAdmin = await admin(off);
    const product = await createProduct();
    const res = await upload(offAdmin.agent, product.id, await jpegWithExif());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FILES_UNAVAILABLE');

    const app = appWith(false);
    const { agent } = await admin(app);
    expect((await upload(agent, 99999, await jpegWithExif())).status).toBe(404);
    const client = await loggedInAgent(app);
    expect((await upload(client.agent, product.id, await jpegWithExif())).status).toBe(403);
  });

  it('reorders photos (the first is the cover), listing each once', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const product = await createProduct();
    const a = await createProductPhoto({ productId: product.id });
    const b = await createProductPhoto({ productId: product.id });
    const order = (photoIds: unknown[]) =>
      send(agent, 'put', `${base}/products/${product.id}/photo-order`).send({ photoIds });

    const res = await order([b.id, a.id].map(Number));
    expect(res.body.data.photos.map((p: { id: number }) => p.id)).toEqual([b.id, a.id].map(Number));
    for (const bad of [[Number(a.id)], [Number(a.id), Number(a.id)], [Number(a.id), 99999]]) {
      const refused = await order(bad);
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('PHOTO_ORDER_INVALID');
    }
  });

  it('deletes a photo and its stored files', async () => {
    const app = appWith(false);
    const { agent } = await admin(app);
    const product = await createProduct();
    const res = await upload(agent, product.id, await jpegWithExif());
    const photoId = res.body.data.photos[0].id;

    const deleted = await send(agent, 'delete', `${base}/photos/${photoId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.photos).toEqual([]);
    expect(storage.objects.size).toBe(0);
    expect((await send(agent, 'delete', `${base}/photos/${photoId}`)).status).toBe(404);
  });
});
