import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestLogger } from '../requestLogger.js';

function buildApp() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = express();
  app.use(requestLogger({ logger }));
  app.get('/ok', (req, res) => res.end());
  app.get('/missing', (req, res) => res.status(404).end());
  app.get('/broken', (req, res) => res.status(500).end());
  app.get('/api/v1/auth/google/callback', (req, res) => res.redirect(303, '/'));
  app.post('/api/v1/webhooks/shippo', (req, res) => res.end());
  return { app, logger };
}

describe('requestLogger', () => {
  it('logs method, path with query, status and duration at a level matching the status', async () => {
    const { app, logger } = buildApp();

    await request(app).get('/ok?page=2');
    await request(app).get('/missing');
    await request(app).get('/broken');

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/ok?page=2',
        statusCode: 200,
        durationMs: expect.any(Number),
      }),
      'request completed',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 }),
      'request completed',
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500 }),
      'request completed',
    );
  });

  it("never logs the Google callback's one-time code and state", async () => {
    const { app, logger } = buildApp();

    await request(app).get('/api/v1/auth/google/callback?code=secret-code&state=secret-state');

    const [fields] = logger.info.mock.calls[0];
    expect(fields.path).toBe('/api/v1/auth/google/callback?[REDACTED]');
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/secret/);
  });

  it("never logs the secret in Shippo's webhook link", async () => {
    const { app, logger } = buildApp();

    await request(app).post('/api/v1/webhooks/shippo?token=secret-token');

    const [fields] = logger.info.mock.calls[0];
    expect(fields.path).toBe('/api/v1/webhooks/shippo?[REDACTED]');
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/secret/);
  });
});
