import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createUser, createUserWithPassword } from '../../../../tests/factories/index.js';
import { TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';

const app = createApp();
beforeEach(truncateAllTables);

// `client` is a Supertest client: request(app) for one-off calls, or an agent that keeps cookies.
const post = (client, path) => client.post(`/api/v1/auth${path}`).set('Origin', TRUSTED_ORIGIN);

function sessionCookie(res) {
  return (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('sid='));
}

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

describe('POST /api/v1/auth/login: verification and Google-only accounts', () => {
  it('refuses an unverified account with 403 EMAIL_NOT_VERIFIED, but only with the right password', async () => {
    const user = await createUserWithPassword({ emailVerifiedAt: null });

    const right = await post(request(app), '/login').send({
      email: user.email,
      password: user.password,
    });
    const wrong = await post(request(app), '/login').send({
      email: user.email,
      password: 'not the password',
    });

    expect(right.status).toBe(403);
    expect(right.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(sessionCookie(right)).toBeUndefined();
    // A wrong password gets the usual answer, so the 403 reveals nothing to a guesser.
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('treats a Google-only account (no password) like a wrong password', async () => {
    const user = await createUser({ passwordHash: null });

    const res = await post(request(app), '/login').send({
      email: user.email,
      password: 'anything at all',
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
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

describe('GET /api/v1/auth/session', () => {
  it('answers 200 with null when nobody is logged in (not an error)', async () => {
    const res = await request(app).get('/api/v1/auth/session');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: null });
  });

  it('returns the logged-in user, without the password hash', async () => {
    const user = await createUserWithPassword();
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ email: user.email, password: user.password });

    const res = await agent.get('/api/v1/auth/session');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: user.id, email: user.email, role: 'client' });
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  it('answers null once the account behind the session is gone', async () => {
    const user = await createUserWithPassword();
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ email: user.email, password: user.password });
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);

    expect((await agent.get('/api/v1/auth/session')).body).toEqual({ data: null });
  });
});
