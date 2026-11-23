/**
 * The account page's endpoints (milestone 7c): GET/PATCH/DELETE /users/me and
 * POST /users/me/password. Deletion anonymizes the account (ADR 0012).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  TEST_PASSWORD,
  createCommission,
  createIdentity,
  createPayment,
  createQuotedCommission,
  createUser,
} from '../../../../tests/factories/index.js';
import { TRUSTED_ORIGIN, loggedInAgent } from '../../../../tests/helpers/auth.js';

const app = createApp();
beforeEach(truncateAllTables);

const ME = '/api/v1/users/me';
const PASSWORD = '/api/v1/users/me/password';
const NEW_PASSWORD = 'a brand new long passphrase';

/** A signed-in user who only uses Google: no password, one Google identity. */
async function googleOnlyAgent() {
  const { agent, user } = await loggedInAgent(app);
  await pool.query('UPDATE users SET password_hash = NULL WHERE id = $1', [user.id]);
  await createIdentity({ userId: user.id, email: user.email });
  return { agent, user };
}

async function userRow(id: number) {
  const { rows } = await pool.query(
    'SELECT email, password_hash, display_name, email_verified_at, deleted_at FROM users WHERE id = $1',
    [id],
  );
  return rows[0];
}

function login(email: string, password: string) {
  return request(app)
    .post('/api/v1/auth/login')
    .set('Origin', TRUSTED_ORIGIN)
    .send({ email, password });
}

describe('GET /api/v1/users/me (sign-in methods)', () => {
  it('reports a Google-only account as having no password', async () => {
    const { agent } = await googleOnlyAgent();

    const res = await agent.get(ME);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ hasPassword: false, hasGoogle: true });
  });
});

describe('PATCH /api/v1/users/me', () => {
  it('changes the display name', async () => {
    const { agent, user } = await loggedInAgent(app);

    const res = await agent
      .patch(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ displayName: '  Noor  ', role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ displayName: 'Noor', role: 'client', hasPassword: true });
    expect((await userRow(user.id)).display_name).toBe('Noor');
  });

  it('rejects an empty name with 400', async () => {
    const { agent } = await loggedInAgent(app);

    const res = await agent.patch(ME).set('Origin', TRUSTED_ORIGIN).send({ displayName: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without a session', async () => {
    const res = await request(app)
      .patch(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ displayName: 'x' });

    expect(res.status).toBe(401);
  });

  it('refuses a request from an untrusted origin with 403', async () => {
    const { agent } = await loggedInAgent(app);

    const res = await agent
      .patch(ME)
      .set('Origin', 'https://evil.example')
      .send({ displayName: 'x' });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/users/me/password', () => {
  it('changes the password, keeps this browser signed in, and signs out every other session', async () => {
    const { agent, user } = await loggedInAgent(app);
    const other = request.agent(app);
    await other
      .post('/api/v1/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ email: user.email, password: TEST_PASSWORD });

    const res = await agent
      .post(PASSWORD)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(204);
    expect((await agent.get(ME)).status).toBe(200);
    expect((await other.get(ME)).status).toBe(401);
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(401);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('refuses a wrong current password with 403 and changes nothing', async () => {
    const { agent, user } = await loggedInAgent(app);

    const res = await agent
      .post(PASSWORD)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ currentPassword: 'not my password', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_INCORRECT');
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(200);
  });

  it('rejects a new password that is too short with 400', async () => {
    const { agent } = await loggedInAgent(app);

    const res = await agent
      .post(PASSWORD)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'newPassword' })]),
    );
  });

  it('answers 422 NO_PASSWORD for an account that only uses Google', async () => {
    const { agent } = await googleOnlyAgent();

    const res = await agent
      .post(PASSWORD)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ currentPassword: 'anything', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_PASSWORD');
  });

  it('returns 401 without a session', async () => {
    const res = await request(app)
      .post(PASSWORD)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/v1/users/me', () => {
  it('anonymizes the account, signs out everywhere, and frees the email', async () => {
    const { agent, user } = await loggedInAgent(app);
    const other = request.agent(app);
    await other
      .post('/api/v1/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ email: user.email, password: TEST_PASSWORD });
    await createIdentity({ userId: user.id, email: user.email });
    await pool.query(
      `INSERT INTO email_verifications (email, code_hash, expires_at, sent_at)
       VALUES ($1, $2, now() + interval '15 minutes', now())`,
      [user.email, 'a'.repeat(64)],
    );

    const res = await agent
      .delete(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^sid=;/);
    expect((await agent.get(ME)).status).toBe(401);
    expect((await other.get(ME)).status).toBe(401);
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(401);

    expect(await userRow(user.id)).toEqual({
      email: null,
      password_hash: null,
      display_name: 'Deleted user',
      email_verified_at: null,
      deleted_at: expect.any(Date),
    });
    const leftovers = await pool.query(
      `SELECT (SELECT count(*) FROM auth_identities WHERE user_id = $1)::int AS identities,
              (SELECT count(*) FROM email_verifications WHERE email = $2)::int AS codes`,
      [user.id, user.email],
    );
    expect(leftovers.rows[0]).toEqual({ identities: 0, codes: 0 });

    // The same email can make a new, separate account.
    await expect(createUser({ email: user.email })).resolves.toMatchObject({ email: user.email });
  });

  it('cancels unpaid requests, keeps finished ones and their payments, and clears notes', async () => {
    const { agent, user } = await loggedInAgent(app);
    const inquiry = await createCommission({ clientId: user.id, notes: 'My sister Ana' });
    const quoted = await createQuotedCommission({ clientId: user.id });
    const delivered = await createQuotedCommission({ clientId: user.id, status: 'delivered' });
    await createPayment({ commissionId: delivered.id, type: 'deposit', amountCents: 5000 });

    const res = await agent
      .delete(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(204);
    const { rows } = await pool.query(
      'SELECT id, status, notes FROM commissions WHERE client_id = $1 ORDER BY id',
      [user.id],
    );
    expect(rows).toEqual([
      { id: inquiry.id, status: 'canceled', notes: null },
      { id: quoted.id, status: 'canceled', notes: null },
      { id: delivered.id, status: 'delivered', notes: null },
    ]);
    const events = await pool.query(
      `SELECT from_status, to_status, actor_type, actor_user_id, reason FROM commission_events
        WHERE commission_id = $1`,
      [quoted.id],
    );
    expect(events.rows).toEqual([
      {
        from_status: 'quoted',
        to_status: 'canceled',
        actor_type: 'client',
        actor_user_id: user.id,
        reason: 'Account deleted',
      },
    ]);
    const payments = await pool.query('SELECT count(*)::int AS n FROM payments');
    expect(payments.rows[0].n).toBe(1);
  });

  it('runs the after-cancel step for each cancelled request, even if one fails', async () => {
    const hooked = createApp();
    const hook = vi
      .fn()
      .mockRejectedValueOnce(new Error('Stripe is down'))
      .mockResolvedValue(undefined);
    hooked.locals.onCommissionStatusChange = hook;
    const { agent, user } = await loggedInAgent(hooked);
    await createCommission({ clientId: user.id });
    await createQuotedCommission({ clientId: user.id });

    const res = await agent
      .delete(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(204);
    expect(hook).toHaveBeenCalledTimes(2);
    expect(hook.mock.calls.map(([c]) => c.status)).toEqual(['canceled', 'canceled']);
  });

  it('refuses while a paid commission is in progress (422) and changes nothing', async () => {
    const { agent, user } = await loggedInAgent(app);
    const inquiry = await createCommission({ clientId: user.id });
    const paid = await createQuotedCommission({ clientId: user.id, status: 'deposit_paid' });

    const res = await agent
      .delete(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'ACTIVE_COMMISSIONS',
      details: { commissionIds: [paid.id] },
    });
    expect((await userRow(user.id)).deleted_at).toBeNull();
    const { rows } = await pool.query('SELECT status FROM commissions WHERE id = $1', [inquiry.id]);
    expect(rows[0].status).toBe('inquiry');
    expect((await agent.get(ME)).status).toBe(200);
  });

  it('refuses a wrong password with 403', async () => {
    const { agent, user } = await loggedInAgent(app);

    const res = await agent
      .delete(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: 'wrong one' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_INCORRECT');
    expect((await userRow(user.id)).deleted_at).toBeNull();
  });

  it('asks a password account for its password, not the email (400)', async () => {
    const { agent, user } = await loggedInAgent(app);

    const res = await agent
      .delete(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ confirmEmail: user.email });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PASSWORD_REQUIRED');
  });

  it('rejects a request with no confirmation at all (400)', async () => {
    const { agent } = await loggedInAgent(app);

    const res = await agent.delete(ME).set('Origin', TRUSTED_ORIGIN).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lets a Google-only account confirm by typing its email, in any letter case', async () => {
    const { agent, user } = await googleOnlyAgent();

    const wrong = await agent
      .delete(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ confirmEmail: 'someone@else.example' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('EMAIL_CONFIRMATION_INCORRECT');

    const res = await agent
      .delete(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ confirmEmail: ` ${user.email.toUpperCase()} ` });
    expect(res.status).toBe(204);
    expect((await userRow(user.id)).deleted_at).not.toBeNull();
  });

  it('never deletes the admin account (422)', async () => {
    const { agent, user } = await loggedInAgent(app, { role: 'admin' });

    const res = await agent
      .delete(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ADMIN_ACCOUNT');
    expect((await userRow(user.id)).deleted_at).toBeNull();
  });

  it('returns 401 without a session', async () => {
    const res = await request(app)
      .delete(ME)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(401);
  });

  it('hides deleted accounts from the admin user list and lookups', async () => {
    const { agent: client, user } = await loggedInAgent(app);
    await client.delete(ME).set('Origin', TRUSTED_ORIGIN).send({ password: TEST_PASSWORD });
    const { agent: admin } = await loggedInAgent(app, { role: 'admin' });

    const list = await admin.get('/api/v1/users');
    expect(list.body.data.map((u: { id: number }) => u.id)).not.toContain(user.id);
    expect(list.body.meta.total).toBe(1);
    expect((await admin.get(`/api/v1/users/${user.id}`)).status).toBe(404);
  });
});
