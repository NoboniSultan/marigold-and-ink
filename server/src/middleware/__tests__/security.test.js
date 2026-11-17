import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../rateLimit.js';
import { requireTrustedOrigin } from '../originCheck.js';
import { errorHandler } from '../errorHandler.js';

const silentLogger = { error: vi.fn() };

describe('createRateLimiter', () => {
  function buildApp(options) {
    const app = express();
    app.post('/attempt', createRateLimiter({ windowMs: 60_000, ...options }), (req, res) =>
      res.status(req.query.fail ? 401 : 200).end(),
    );
    app.use(errorHandler({ logger: silentLogger }));
    return app;
  }

  it('returns 429 RATE_LIMITED in the standard error shape once the limit is hit', async () => {
    const app = buildApp({ limit: 2 });

    await request(app).post('/attempt');
    await request(app).post('/attempt');
    const res = await request(app).post('/attempt');

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
    });
    expect(res.headers['ratelimit']).toBeDefined();
  });

  it('with skipSuccessfulRequests, counts only failed attempts', async () => {
    const app = buildApp({ limit: 2, skipSuccessfulRequests: true });

    for (let i = 0; i < 5; i += 1) {
      expect((await request(app).post('/attempt')).status).toBe(200);
    }
    await request(app).post('/attempt?fail=1');
    await request(app).post('/attempt?fail=1');

    expect((await request(app).post('/attempt?fail=1')).status).toBe(429);
  });
});

describe('requireTrustedOrigin (CSRF)', () => {
  function buildApp() {
    const app = express();
    app.use(requireTrustedOrigin({ allowedOrigins: ['https://shop.example'] }));
    app.all('/thing', (_req, res) => res.status(204).end());
    app.use(errorHandler({ logger: silentLogger }));
    return app;
  }

  it.each([
    ['an allowed Origin', { Origin: 'https://shop.example' }, 204],
    ['a foreign Origin', { Origin: 'https://evil.example' }, 403],
    ['the literal "null" Origin (sandboxed frame)', { Origin: 'null' }, 403],
    ['no Origin but an allowed Referer', { Referer: 'https://shop.example/page' }, 204],
    ['no Origin and a foreign Referer', { Referer: 'https://evil.example/x' }, 403],
    ['an unparseable Referer', { Referer: 'not a url' }, 403],
    ['neither header (non-browser client)', {}, 204],
  ])('POST with %s -> %i', async (_label, headers, status) => {
    const res = await request(buildApp()).post('/thing').set(headers);

    expect(res.status).toBe(status);
    if (status === 403) expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
  });

  it('never blocks safe methods', async () => {
    const res = await request(buildApp()).get('/thing').set('Origin', 'https://evil.example');

    expect(res.status).toBe(204);
  });
});
