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

  it('allows CORS only for configured origins', async () => {
    const allowedOrigin = process.env.CORS_ORIGINS.split(',')[0].trim();

    const allowed = await request(app).get('/api/v1/health').set('Origin', allowedOrigin);
    const blocked = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');

    expect(allowed.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
