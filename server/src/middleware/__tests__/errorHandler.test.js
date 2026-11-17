import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../errorHandler.js';
import { notFound } from '../notFound.js';
import { ConflictError, ServiceUnavailableError, ValidationError } from '../../errors/index.js';

// A tiny app with routes that fail in different ways, so the handler is tested in isolation.
function buildApp(logger) {
  const app = express();
  app.use(express.json({ limit: '1kb' }));

  app.get('/conflict', () => {
    throw new ConflictError('Cannot ship before payment', {
      code: 'COMMISSION_INVALID_TRANSITION',
      details: { from: 'quoted', to: 'shipped' },
    });
  });
  app.get('/validation', () => {
    throw new ValidationError();
  });
  app.get('/async-bug', async () => {
    await Promise.resolve();
    throw new Error('relation "secret_table" does not exist');
  });
  app.post('/echo', (req, res) => res.json({ data: req.body }));

  app.use(notFound);
  app.use(errorHandler({ logger }));
  return app;
}

const silentLogger = () => ({ error: vi.fn() });

describe('errorHandler', () => {
  it('maps an AppError to its status and the standard error shape', async () => {
    const res = await request(buildApp(silentLogger())).get('/conflict');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'COMMISSION_INVALID_TRANSITION',
        message: 'Cannot ship before payment',
        details: { from: 'quoted', to: 'shipped' },
      },
    });
  });

  it('uses subclass defaults and omits details when there are none', async () => {
    const res = await request(buildApp(silentLogger())).get('/validation');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request' } });
  });

  it('hides unexpected errors behind a generic 500 and logs the real error', async () => {
    const logger = silentLogger();
    const res = await request(buildApp(logger)).get('/async-bug');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret_table|stack/);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0][0].err.message).toMatch(/secret_table/);
  });

  it('returns 400 INVALID_JSON for a malformed JSON body', async () => {
    const res = await request(buildApp(silentLogger()))
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 PAYLOAD_TOO_LARGE when the body exceeds the limit', async () => {
    const res = await request(buildApp(silentLogger()))
      .post('/echo')
      .send({ text: 'x'.repeat(2048) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('does not log deliberate AppErrors as unhandled, even 5xx ones', async () => {
    const logger = silentLogger();
    const app = express();
    app.get('/unavailable', () => {
      throw new ServiceUnavailableError();
    });
    app.use(errorHandler({ logger }));

    await request(buildApp(logger)).get('/conflict');
    const res = await request(app).get('/unavailable');

    expect(res.status).toBe(503);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('notFound', () => {
  it('returns 404 ROUTE_NOT_FOUND in the standard shape', async () => {
    const res = await request(buildApp(silentLogger())).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Route GET /nope not found' },
    });
  });
});
