/**
 * The account page's email change (ADR 0014) and "Download my data":
 * POST /users/me/email, POST /users/me/email/confirm, GET /users/me/export.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  createCommissionEvent,
  createPayment,
  createQuote,
  createQuotedCommission,
  createUser,
} from '../../../../tests/factories/index.js';
import { TRUSTED_ORIGIN, loggedInAgent } from '../../../../tests/helpers/auth.js';
import { fakeEmail } from '../../../../tests/helpers/email.ts';

let email: ReturnType<typeof fakeEmail>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await truncateAllTables();
  email = fakeEmail();
  app = createApp({ adapters: { email: email.sender, google: null, payments: null } });
});

const NEW_ADDRESS = 'moved@example.com';

const startChange = (agent: request.Agent, body: Record<string, unknown>) =>
  agent.post('/api/v1/users/me/email').set('Origin', TRUSTED_ORIGIN).send(body);

const confirmChange = (agent: request.Agent, code: string, newEmail = NEW_ADDRESS) =>
  agent
    .post('/api/v1/users/me/email/confirm')
    .set('Origin', TRUSTED_ORIGIN)
    .send({ newEmail, code });

describe('POST /api/v1/users/me/email', () => {
  it('checks the password, then emails a code to the new address', async () => {
    const { agent, user } = await loggedInAgent(app);

    const res = await startChange(agent, { newEmail: NEW_ADDRESS, password: user.password });

    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ email: NEW_ADDRESS, resendAfterSeconds: 60 });
    expect(email.sent).toEqual([
      expect.objectContaining({
        to: NEW_ADDRESS,
        subject: expect.stringContaining('confirmation code'),
      }),
    ]);
    const { rows } = await pool.query(
      'SELECT purpose, user_id FROM email_verifications WHERE email = $1',
      [NEW_ADDRESS],
    );
    expect(rows).toEqual([{ purpose: 'email_change', user_id: user.id }]);
  });

  it('answers the same when the new address has an account, and tells that address instead', async () => {
    const { agent, user } = await loggedInAgent(app);
    await createUser({ email: NEW_ADDRESS });

    const res = await startChange(agent, { newEmail: NEW_ADDRESS, password: user.password });

    expect(res.status).toBe(202);
    expect(email.sent[0]).toMatchObject({
      to: NEW_ADDRESS,
      subject: expect.stringContaining('already have'),
    });
  });

  it('needs the password on a password account', async () => {
    const { agent } = await loggedInAgent(app);

    const missing = await startChange(agent, { newEmail: NEW_ADDRESS });
    const wrong = await startChange(agent, { newEmail: NEW_ADDRESS, password: 'not the password' });

    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('PASSWORD_REQUIRED');
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('PASSWORD_INCORRECT');
    expect(email.sent).toEqual([]);
  });

  it("doesn't ask a Google-only account for a password it doesn't have", async () => {
    const { agent, user } = await loggedInAgent(app);
    await pool.query('UPDATE users SET password_hash = NULL WHERE id = $1', [user.id]);

    expect((await startChange(agent, { newEmail: NEW_ADDRESS })).status).toBe(202);
  });

  it('refuses the same address, and the admin account (422)', async () => {
    const { agent, user } = await loggedInAgent(app);
    const same = await startChange(agent, { newEmail: user.email, password: user.password });
    expect(same.status).toBe(422);
    expect(same.body.error.code).toBe('EMAIL_UNCHANGED');

    const { agent: adminAgent, user: admin } = await loggedInAgent(app, { role: 'admin' });
    const res = await startChange(adminAgent, { newEmail: NEW_ADDRESS, password: admin.password });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ADMIN_ACCOUNT');
  });

  it('rejects an invalid address (400) and a signed-out visitor (401)', async () => {
    const { agent, user } = await loggedInAgent(app);
    expect((await startChange(agent, { newEmail: 'nope', password: user.password })).status).toBe(
      400,
    );

    const signedOut = await request(app)
      .post('/api/v1/users/me/email')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ newEmail: NEW_ADDRESS });
    expect(signedOut.status).toBe(401);
  });

  it('is unavailable without an email provider (503)', async () => {
    app = createApp({ adapters: { email: null, google: null, payments: null } });
    const { agent, user } = await loggedInAgent(app);

    const res = await startChange(agent, { newEmail: NEW_ADDRESS, password: user.password });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('EMAIL_CHANGE_UNAVAILABLE');
  });
});

describe('POST /api/v1/users/me/email/confirm', () => {
  it('moves the account, keeps this browser signed in, signs out the others, and tells the old address', async () => {
    const { agent, user } = await loggedInAgent(app);
    const elsewhere = request.agent(app);
    await elsewhere
      .post('/api/v1/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ email: user.email, password: user.password });
    await startChange(agent, { newEmail: NEW_ADDRESS, password: user.password });

    const res = await confirmChange(agent, email.lastCode()!);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: user.id, email: NEW_ADDRESS });
    expect(res.body.data.emailVerifiedAt).toEqual(expect.any(String));
    expect((await agent.get('/api/v1/users/me')).body.data.email).toBe(NEW_ADDRESS);
    expect((await elsewhere.get('/api/v1/users/me')).status).toBe(401);
    expect(email.sent.at(-1)).toMatchObject({
      to: user.email,
      subject: expect.stringContaining('was changed'),
      text: expect.stringContaining(NEW_ADDRESS),
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ email: NEW_ADDRESS, password: user.password });
    expect(login.status).toBe(200);
  });

  it("still moves the account if the old address's notice fails", async () => {
    const { agent, user } = await loggedInAgent(app);
    await startChange(agent, { newEmail: NEW_ADDRESS, password: user.password });
    const code = email.lastCode()!;
    email.failOnce();

    expect((await confirmChange(agent, code)).status).toBe(200);
  });

  it("won't use another account's pending change, even with its code", async () => {
    const { agent: first, user } = await loggedInAgent(app);
    const { agent: second } = await loggedInAgent(app);
    await startChange(first, { newEmail: NEW_ADDRESS, password: user.password });

    const res = await confirmChange(second, email.lastCode()!);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
    expect((await confirmChange(first, email.lastCode()!)).status).toBe(200); // still usable
  });

  it('counts a wrong code (422)', async () => {
    const { agent, user } = await loggedInAgent(app);
    await startChange(agent, { newEmail: NEW_ADDRESS, password: user.password });
    const wrong = email.lastCode() === '000000' ? '111111' : '000000';

    const res = await confirmChange(agent, wrong);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CODE_INCORRECT');
  });

  it('refuses if another account took the address in the meantime (409)', async () => {
    const { agent, user } = await loggedInAgent(app);
    await startChange(agent, { newEmail: NEW_ADDRESS, password: user.password });
    await createUser({ email: NEW_ADDRESS });

    const res = await confirmChange(agent, email.lastCode()!);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect((await agent.get('/api/v1/users/me')).body.data.email).toBe(user.email);
  });

  it('rejects a malformed code (400)', async () => {
    const { agent } = await loggedInAgent(app);
    expect((await confirmChange(agent, '12')).status).toBe(400);
  });
});

describe('GET /api/v1/users/me/export', () => {
  it("downloads the account and the client's own commissions, with history, quote, and payments", async () => {
    const { agent, user } = await loggedInAgent(app);
    const mine = await createQuotedCommission({ clientId: user.id });
    await createCommissionEvent({ commissionId: mine.id, toStatus: 'quoted', actorType: 'system' });
    await createQuote({ commissionId: mine.id, status: 'sent', sentAt: new Date() });
    await createPayment({ commissionId: mine.id });
    await createQuotedCommission(); // someone else's

    const res = await agent.get('/api/v1/users/me/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('marigold-and-ink-my-data.json');
    const { data } = JSON.parse(res.text);
    expect(data.exportedAt).toEqual(expect.any(String));
    expect(data.account).toMatchObject({ id: user.id, email: user.email, hasPassword: true });
    expect(data.commissions).toHaveLength(1);
    expect(data.commissions[0]).toMatchObject({
      id: mine.id,
      events: [expect.objectContaining({ toStatus: 'quoted' })],
      quote: expect.objectContaining({ status: 'sent' }),
      payments: [expect.objectContaining({ type: 'deposit', amountCents: 5000 })],
    });
    // Clients see payments as on the site: no admin notes, no Stripe IDs.
    expect(data.commissions[0].payments[0]).not.toHaveProperty('reason');
    expect(JSON.stringify(data)).not.toContain('cs_test_');
  });

  it('gives an empty list to a client with no commissions, and a null quote before one is sent', async () => {
    const { agent, user } = await loggedInAgent(app);
    const { data: empty } = JSON.parse((await agent.get('/api/v1/users/me/export')).text);
    expect(empty.commissions).toEqual([]);

    await createQuotedCommission({ clientId: user.id });
    const { data } = JSON.parse((await agent.get('/api/v1/users/me/export')).text);
    expect(data.commissions[0].quote).toBeNull();
  });

  it('needs a signed-in user (401)', async () => {
    expect((await request(app).get('/api/v1/users/me/export')).status).toBe(401);
  });
});

describe('account deletion and pending codes', () => {
  it("removes the account's pending email change", async () => {
    const { agent, user } = await loggedInAgent(app);
    await startChange(agent, { newEmail: NEW_ADDRESS, password: user.password });

    const res = await agent
      .delete('/api/v1/users/me')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: user.password });

    expect(res.status).toBe(204);
    const { rows } = await pool.query('SELECT 1 FROM email_verifications');
    expect(rows).toEqual([]);
  });
});
