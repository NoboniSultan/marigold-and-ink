import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createUser, createUserWithPassword } from '../../../../tests/factories/index.js';
import { TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';

const app = createApp();
beforeEach(truncateAllTables);

const validRegistration = () => ({
  email: 'new.client@example.com',
  password: 'a long enough password',
  displayName: 'New Client',
});

// `client` is a Supertest client: request(app) for one-off calls, or an agent that keeps cookies.
const post = (client, path) => client.post(`/api/v1/auth${path}`).set('Origin', TRUSTED_ORIGIN);

function sessionCookie(res) {
  return (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('sid='));
}

describe('POST /api/v1/auth/register', () => {
  it('creates a client account, logs them in, and never returns the password hash', async () => {
    const agent = request.agent(app);
    const res = await post(agent, '/register').send(validRegistration());

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(Number),
      email: 'new.client@example.com',
      displayName: 'New Client',
      role: 'client',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const me = await agent.get('/api/v1/users/me');
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(res.body.data.id);
  });

  it('stores a bcrypt hash, not the password', async () => {
    await post(request(app), '/register').send(validRegistration());

    const { rows } = await pool.query('SELECT password_hash FROM users');
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(rows[0].password_hash).not.toContain('a long enough password');
  });

  it('normalizes the email (trim + lowercase)', async () => {
    const res = await post(request(app), '/register').send({
      ...validRegistration(),
      email: '  New.Client@Example.COM ',
    });

    expect(res.body.data.email).toBe('new.client@example.com');
  });

  it('ignores a client-supplied role', async () => {
    const res = await post(request(app), '/register').send({
      ...validRegistration(),
      role: 'admin',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('client');
  });

  it('rejects a duplicate email, regardless of case, with 409 EMAIL_TAKEN', async () => {
    await createUser({ email: 'new.client@example.com' });

    const res = await post(request(app), '/register').send({
      ...validRegistration(),
      email: 'NEW.CLIENT@example.com',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(sessionCookie(res)).toBeUndefined();
  });

  it.each([
    ['a password shorter than 12 characters', { password: 'short pass' }, 'password'],
    ['a password over 72 bytes', { password: 'é'.repeat(37) }, 'password'], // 74 bytes
    ['an invalid email', { email: 'not-an-email' }, 'email'],
    ['a blank display name', { displayName: '   ' }, 'displayName'],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, override, field) => {
    const res = await post(request(app), '/register').send({ ...validRegistration(), ...override });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ location: 'body', path: field })]),
    );
  });

  it('rejects a missing body with every required field listed', async () => {
    const res = await post(request(app), '/register').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.path).sort()).toEqual([
      'displayName',
      'email',
      'password',
    ]);
  });

  it('sends rate-limit headers', async () => {
    const res = await post(request(app), '/register').send(validRegistration());

    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('blocks a cross-site request with 403 CSRF_ORIGIN_MISMATCH', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', 'https://evil.example')
      .send(validRegistration());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in with the right password and sets a session cookie', async () => {
    const user = await createUserWithPassword();

    const res = await post(request(app), '/login').send({
      email: user.email,
      password: user.password,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: user.id, email: user.email, role: 'client' });
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect(sessionCookie(res)).toBeDefined();
  });

  it('accepts the email in any case', async () => {
    const user = await createUserWithPassword({ email: 'case@example.com' });

    const res = await post(request(app), '/login').send({
      email: 'CASE@Example.com',
      password: user.password,
    });

    expect(res.status).toBe(200);
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS and no session', async () => {
    const user = await createUserWithPassword();

    const res = await post(request(app), '/login').send({
      email: user.email,
      password: 'wrong password!',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('gives an unknown email the exact same response as a wrong password', async () => {
    const res = await post(request(app), '/login').send({
      email: 'nobody@example.com',
      password: 'whatever password',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('rejects a missing password with 400', async () => {
    const res = await post(request(app), '/login').send({ email: 'someone@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('issues a new session ID on every login (prevents session fixation)', async () => {
    const user = await createUserWithPassword();
    const credentials = { email: user.email, password: user.password };
    const agent = request.agent(app);

    const first = sessionCookie(await post(agent, '/login').send(credentials));
    const second = sessionCookie(await post(agent, '/login').send(credentials));

    expect(first.split(';')[0]).not.toBe(second.split(';')[0]);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('ends the session: the cookie is cleared and the session row deleted', async () => {
    const user = await createUserWithPassword();
    const agent = request.agent(app);
    await post(agent, '/login').send({ email: user.email, password: user.password });

    const res = await post(agent, '/logout');

    expect(res.status).toBe(204);
    expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await agent.get('/api/v1/users/me')).status).toBe(401);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM sessions');
    expect(rows[0].n).toBe(0);
  });

  it('succeeds without a session (idempotent)', async () => {
    const res = await post(request(app), '/logout');

    expect(res.status).toBe(204);
  });
});
