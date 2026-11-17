import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { createLogger } from '../logger.js';
import { runWithRequestContext, getRequestContext } from '../requestContext.js';
import { requestId } from '../../middleware/requestId.js';

function captureLogger() {
  const lines = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });
  return { logger: createLogger({ level: 'info', destination }), lines };
}

describe('logger', () => {
  it('adds the current request ID to every line logged inside a request context', async () => {
    const { logger, lines } = captureLogger();

    await runWithRequestContext({ requestId: 'req-123' }, async () => {
      await Promise.resolve(); // crosses an await, like a service calling a repository
      logger.info('inside request');
    });
    logger.info('outside request');

    expect(lines[0]).toMatchObject({ msg: 'inside request', requestId: 'req-123' });
    expect(lines[1].requestId).toBeUndefined();
  });

  it('redacts passwords', () => {
    const { logger, lines } = captureLogger();

    logger.info({ user: { email: 'a@b.c', password: 'hunter2' } }, 'login attempt');

    expect(lines[0].user).toEqual({ email: 'a@b.c', password: '[REDACTED]' });
  });
});

describe('requestId middleware', () => {
  function buildApp() {
    const app = express();
    app.use(requestId);
    app.use(express.json());
    // Reads the context after the body parser has run, to prove it survives it.
    app.post('/context', (_req, res) => res.json(getRequestContext() ?? null));
    return app;
  }

  it('generates a UUID and returns it in X-Request-Id', async () => {
    const res = await request(buildApp()).post('/context').send({});

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).toEqual({ requestId: res.headers['x-request-id'] });
  });

  it('reuses a safe incoming X-Request-Id', async () => {
    const res = await request(buildApp())
      .post('/context')
      .set('X-Request-Id', 'lb-abc.123')
      .send({ a: 1 });

    expect(res.headers['x-request-id']).toBe('lb-abc.123');
    expect(res.body).toEqual({ requestId: 'lb-abc.123' });
  });

  it('replaces an unsafe incoming X-Request-Id', async () => {
    const res = await request(buildApp())
      .post('/context')
      .set('X-Request-Id', 'bad id with spaces <script>')
      .send({});

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
