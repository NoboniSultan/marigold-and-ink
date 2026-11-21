import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { createClientSiteRouter } from '../clientSite.ts';

// CLIENT_DIST_DIR points at tests/fixtures/client-dist (vitest.config.js).
const app = createApp();

describe('serving the React site', () => {
  it('serves index.html for the home page and for client-side routes, never cached', async () => {
    for (const url of ['/', '/gallery/fawn', '/commission?x=1']) {
      const res = await request(app).get(url).set('Accept', 'text/html');
      expect(res.status, url).toBe(200);
      expect(res.text).toContain('Fixture site');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['set-cookie'], 'no session needed').toBeUndefined();
    }
  });

  it('caches hashed assets for a year, and 404s a missing one instead of sending the page', async () => {
    const asset = await request(app).get('/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const missing = await request(app).get('/assets/old-deadbeef.js').set('Accept', 'text/html');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ASSET_NOT_FOUND');
  });

  it('serves other public files with a short cache', async () => {
    const res = await request(app).get('/brand/favicon-32.png');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
  });

  it('keeps API and media 404s as JSON, even for browsers asking for HTML', async () => {
    for (const url of ['/api/v1/nope', '/media/artworks/nope.webp']) {
      const res = await request(app).get(url).set('Accept', 'text/html');
      expect(res.status, url).toBe(404);
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    }
  });

  it('does not answer non-HTML requests with the page', async () => {
    const res = await request(app).get('/some/file.json').set('Accept', 'application/json');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('keeps the strict security headers on the page', async () => {
    const res = await request(app).get('/').set('Accept', 'text/html');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('is skipped when the site has not been built', () => {
    expect(createClientSiteRouter('/no/such/dist')).toBeNull();
  });
});
