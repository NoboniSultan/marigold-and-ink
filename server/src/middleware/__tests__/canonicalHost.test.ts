import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { canonicalHost } from '../canonicalHost.ts';
import { createApp } from '../../app.js';

const PUBLIC = 'https://noboni.example';

describe('canonicalHost', () => {
  const app = express();
  app.use(canonicalHost(PUBLIC));
  app.all('/{*rest}', (_req, res) => res.status(200).send('served'));

  it('redirects a page request on another host to the public address, keeping path and query', async () => {
    const res = await request(app)
      .get('/gallery/fawn?page=2')
      .set('Host', 'marigold-and-ink-api.onrender.com');

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://noboni.example/gallery/fawn?page=2');
  });

  it('redirects www. and HEAD requests too', async () => {
    const res = await request(app).head('/').set('Host', 'www.noboni.example');

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://noboni.example/');
  });

  it('serves requests already on the public host', async () => {
    const res = await request(app).get('/about').set('Host', 'noboni.example');

    expect(res.status).toBe(200);
  });

  it('never redirects to another host, even for a path starting with //', async () => {
    const res = await request(app).get('//evil.example/x').set('Host', 'old.example');

    expect(res.status).toBe(301);
    expect(new URL(res.headers.location ?? '').host).toBe('noboni.example');
  });

  it('lets other methods through, so a form posted from an old tab still gets an answer', async () => {
    const res = await request(app).post('/api/v1/commissions').set('Host', 'old.example');

    expect(res.status).toBe(200);
  });

  it('answers the Stripe webhook and the health check on any host', async () => {
    for (const path of ['/api/v1/webhooks/stripe', '/api/v1/health']) {
      const res = await request(app).get(path).set('Host', 'old.example');
      expect(res.status, path).toBe(200);
    }
    const webhook = await request(app).post('/api/v1/webhooks/stripe').set('Host', 'old.example');
    expect(webhook.status).toBe(200);
  });

  it('is wired into createApp when a canonical URL is given, and off by default outside production', async () => {
    const adapters = { email: null, google: null, payments: null };
    const withRedirect = createApp({ adapters, canonicalUrl: PUBLIC });
    const without = createApp({ adapters });

    const redirected = await request(withRedirect).get('/gallery').set('Host', 'old.example');
    expect(redirected.status).toBe(301);
    expect(redirected.headers.location).toBe('https://noboni.example/gallery');

    const notRedirected = await request(without).get('/api/v1/nope').set('Host', 'old.example');
    expect(notRedirected.status).toBe(404);
  });
});
