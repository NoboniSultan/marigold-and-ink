import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';

const app = createApp();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/v1/health', () => {
  it('returns 200 with app status and a successful database ping', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      data: {
        status: 'ok',
        uptimeSeconds: expect.any(Number),
        timestamp: expect.any(String),
        checks: { database: 'ok' },
      },
    });
  });

  it('returns 503 in the standard error shape when the database is unreachable', async () => {
    vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database is unavailable',
        details: { checks: { database: 'down' } },
      },
    });
  });
});

describe('app-level middleware', () => {
  it('returns 404 ROUTE_NOT_FOUND for unknown API routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('sets a request ID and security headers on every response', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it("lets pages show images only from the site, and from the file bucket once it's set up", async () => {
    const imgSrc = (header) => header.split(';').find((part) => part.trim().startsWith('img-src'));

    const without = await request(app).get('/api/v1/health');
    expect(imgSrc(without.headers['content-security-policy'])).toBe("img-src 'self' data:");

    const bucket =
      'https://marigold-files.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';
    const withFiles = createApp({
      adapters: { email: null, google: null, payments: null },
      fileOrigin: bucket,
    });
    const res = await request(withFiles).get('/api/v1/health');
    expect(imgSrc(res.headers['content-security-policy'])).toBe(`img-src 'self' data: ${bucket}`);
  });

  it('allows CORS only for configured origins', async () => {
    const allowedOrigin = process.env.CORS_ORIGINS.split(',')[0].trim();

    const allowed = await request(app).get('/api/v1/health').set('Origin', allowedOrigin);
    const blocked = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');

    expect(allowed.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
