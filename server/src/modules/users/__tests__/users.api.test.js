import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createUser } from '../../../../tests/factories/index.js';
import { loggedInAgent } from '../../../../tests/helpers/auth.js';

const app = createApp();
beforeEach(truncateAllTables);

describe('GET /api/v1/users/me', () => {
  it('returns the logged-in user without the password hash', async () => {
    const { agent, user } = await loggedInAgent(app);

    const res = await agent.get('/api/v1/users/me');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: 'client',
      emailVerifiedAt: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('returns 401 without a session', async () => {
    const res = await request(app).get('/api/v1/users/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 with a forged session cookie', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Cookie', 'sid=s%3Aforged.signature');

    expect(res.status).toBe(401);
  });

  it('returns 401 if the account was deleted after logging in', async () => {
    const { agent, user } = await loggedInAgent(app);
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);

    const res = await agent.get('/api/v1/users/me');

    expect(res.status).toBe(401);
  });

  it('reflects a role change immediately (role is read from the database, not the session)', async () => {
    const { agent, user } = await loggedInAgent(app);
    await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [user.id]);

    const res = await agent.get('/api/v1/users/me');

    expect(res.body.data.role).toBe('admin');
  });
});

describe('GET /api/v1/users/:id (ownership)', () => {
  it('lets a client view their own record', async () => {
    const { agent, user } = await loggedInAgent(app);

    const res = await agent.get(`/api/v1/users/${user.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(user.id);
  });

  it("blocks a client from another client's record with 403", async () => {
    const { agent } = await loggedInAgent(app);
    const other = await createUser();

    const res = await agent.get(`/api/v1/users/${other.id}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('lets an admin view any record', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const other = await createUser();

    const res = await agent.get(`/api/v1/users/${other.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(other.id);
  });

  it('returns 404 USER_NOT_FOUND to an admin for a missing user', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });

    const res = await agent.get('/api/v1/users/999999');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('rejects a non-numeric ID with 400', async () => {
    const { agent } = await loggedInAgent(app);

    const res = await agent.get('/api/v1/users/abc');

    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ location: 'params', path: 'id' });
  });

  it('returns 401 without a session', async () => {
    const other = await createUser();

    const res = await request(app).get(`/api/v1/users/${other.id}`);

    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/users (admin only)', () => {
  it('lists users with pagination meta for an admin', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    await createUser();
    await createUser();

    const res = await agent.get('/api/v1/users?page=1&pageSize=2');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('reports the total even on a page past the end', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });

    const res = await agent.get('/api/v1/users?page=5&pageSize=10');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(1);
  });

  it('blocks a client with 403', async () => {
    const { agent } = await loggedInAgent(app);

    const res = await agent.get('/api/v1/users');

    expect(res.status).toBe(403);
  });

  it('returns 401 without a session', async () => {
    const res = await request(app).get('/api/v1/users');

    expect(res.status).toBe(401);
  });

  it('rejects an oversized page with 400', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });

    const res = await agent.get('/api/v1/users?pageSize=500');

    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ location: 'query', path: 'pageSize' });
  });
});
