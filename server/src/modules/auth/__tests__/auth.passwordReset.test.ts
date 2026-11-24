/** Forgot password (ADR 0014): POST /auth/password-reset/start and /complete. */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { config } from '../../../config/env.js';
import { hashCode } from '../../../lib/verificationCode.ts';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createUser, createUserWithPassword } from '../../../../tests/factories/index.js';
import { TRUSTED_ORIGIN, loggedInAgent } from '../../../../tests/helpers/auth.js';
import { fakeEmail } from '../../../../tests/helpers/email.ts';
import { MAX_ATTEMPTS } from '../auth.codes.ts';

let email: ReturnType<typeof fakeEmail>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await truncateAllTables();
  email = fakeEmail();
  app = createApp({ adapters: { email: email.sender, google: null, payments: null } });
});

const post = (client: request.Agent | ReturnType<typeof request>, path: string) =>
  client.post(`/api/v1/auth/password-reset${path}`).set('Origin', TRUSTED_ORIGIN);

const NEW_PASSWORD = 'a brand new long password';

const start = (address: string) => post(request(app), '/start').send({ email: address });

const complete = (
  address: string,
  code: string,
  agent: request.Agent | ReturnType<typeof request> = request(app),
) => post(agent, '/complete').send({ email: address, code, newPassword: NEW_PASSWORD });

const login = (address: string, password: string) =>
  request(app)
    .post('/api/v1/auth/login')
    .set('Origin', TRUSTED_ORIGIN)
    .send({ email: address, password });

describe('POST /api/v1/auth/password-reset/start', () => {
  it('emails a reset code to a client account, storing only its hash', async () => {
    const user = await createUserWithPassword();

    const res = await start(user.email);

    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ email: user.email, resendAfterSeconds: 60 });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({
      to: user.email,
      subject: expect.stringContaining('password reset code'),
    });
    const { rows } = await pool.query(
      `SELECT purpose, code_hash FROM email_verifications WHERE email = $1`,
      [user.email],
    );
    expect(rows).toEqual([
      { purpose: 'password_reset', code_hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });

  it('answers the same for an address with no account, and sends nothing', async () => {
    const res = await start('nobody@example.com');

    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ email: 'nobody@example.com', resendAfterSeconds: 60 });
    expect(email.sent).toEqual([]);
  });

  it('sends nothing for the admin (its password comes from the server settings)', async () => {
    const admin = await createUserWithPassword({ role: 'admin' });

    expect((await start(admin.email)).status).toBe(202);
    expect(email.sent).toEqual([]);
  });

  it('lets a Google-only account set a password', async () => {
    const user = await createUser({ passwordHash: null });

    await start(user.email);
    const res = await complete(user.email, email.lastCode()!);

    expect(res.status).toBe(200);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('allows one code a minute per address (429)', async () => {
    const user = await createUserWithPassword();
    await start(user.email);

    const res = await start(user.email);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('CODE_RESEND_TOO_SOON');
  });

  it('forgets the code if the email fails, so the visitor can retry at once (503)', async () => {
    const user = await createUserWithPassword();
    email.failOnce();

    const res = await start(user.email);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('EMAIL_SEND_FAILED');
    expect((await start(user.email)).status).toBe(202);
  });

  it('is unavailable without an email provider (503)', async () => {
    app = createApp({ adapters: { email: null, google: null, payments: null } });

    const res = await start('someone@example.com');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PASSWORD_RESET_UNAVAILABLE');
  });

  it('rejects an invalid email (400)', async () => {
    expect((await start('not-an-email')).status).toBe(400);
  });

  it('deletes expired codes for any address when a new one is issued', async () => {
    await pool.query(
      `INSERT INTO email_verifications (purpose, email, code_hash, expires_at, sent_at)
       VALUES ('signup', 'old@example.com', $1, now() - interval '1 minute', now() - interval '20 minutes')`,
      ['b'.repeat(64)],
    );

    await start('someone@example.com');

    const { rows } = await pool.query(
      `SELECT email FROM email_verifications WHERE email = 'old@example.com'`,
    );
    expect(rows).toEqual([]);
  });
});

describe('POST /api/v1/auth/password-reset/complete', () => {
  it('sets the new password, signs in this browser, and signs out every other session', async () => {
    const { agent: elsewhere, user } = await loggedInAgent(app);
    await start(user.email);
    const browser = request.agent(app);

    const res = await complete(user.email, email.lastCode()!, browser);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: user.id, email: user.email });
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect((await browser.get('/api/v1/users/me')).status).toBe(200);
    expect((await elsewhere.get('/api/v1/users/me')).status).toBe(401);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
    expect((await login(user.email, user.password)).status).toBe(401);
  });

  it('uses the code up', async () => {
    const user = await createUserWithPassword();
    await start(user.email);
    const code = email.lastCode()!;
    await complete(user.email, code);

    const res = await complete(user.email, code);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('counts wrong codes, then refuses the code for good', async () => {
    const user = await createUserWithPassword();
    await start(user.email);
    const right = email.lastCode()!;
    const wrong = right === '000000' ? '111111' : '000000';

    const first = await complete(user.email, wrong);
    expect(first.status).toBe(422);
    expect(first.body.error).toMatchObject({
      code: 'CODE_INCORRECT',
      details: { remainingAttempts: MAX_ATTEMPTS - 1 },
    });
    for (let i = 1; i < MAX_ATTEMPTS; i++) await complete(user.email, wrong);

    const res = await complete(user.email, right);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
    expect((await login(user.email, user.password)).status).toBe(200); // unchanged
  });

  it('never accepts a sign-up code as a reset code', async () => {
    const user = await createUserWithPassword();
    await pool.query(
      `INSERT INTO email_verifications (purpose, email, code_hash, expires_at)
       VALUES ('signup', $1, $2, now() + interval '5 minutes')`,
      [user.email, hashCode(user.email, '123456', config.authSecret)],
    );

    const res = await complete(user.email, '123456');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it("refuses a code once the account can't be reset (deleted since)", async () => {
    const user = await createUserWithPassword();
    await start(user.email);
    const code = email.lastCode()!;
    await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [user.id]);

    const res = await complete(user.email, code);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('holds the new password to the sign-up rules (400)', async () => {
    const res = await post(request(app), '/complete').send({
      email: 'someone@example.com',
      code: '123456',
      newPassword: 'short',
    });

    expect(res.status).toBe(400);
  });
});
