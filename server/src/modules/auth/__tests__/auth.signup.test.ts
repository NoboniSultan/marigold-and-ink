import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { verifyPassword } from '../../../lib/password.js';
import type { EmailMessage, EmailSender } from '../../../adapters/email.ts';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createUser, createUserWithPassword } from '../../../../tests/factories/index.js';
import { TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';
import { MAX_ATTEMPTS } from '../auth.signup.service.ts';

/** Records emails instead of sending them; can be told to fail. */
function fakeEmail() {
  const sent: EmailMessage[] = [];
  let failNext = false;
  const sender: EmailSender = {
    async send(message) {
      if (failNext) {
        failNext = false;
        throw new Error('provider down');
      }
      sent.push(message);
    },
  };
  return {
    sender,
    sent,
    failOnce: () => {
      failNext = true;
    },
    lastCode: () => sent.at(-1)?.text.match(/\b(\d{6})\b/)?.[1],
  };
}

let email: ReturnType<typeof fakeEmail>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await truncateAllTables();
  email = fakeEmail();
  app = createApp({ adapters: { email: email.sender, google: null, payments: null } });
});

const post = (client: request.Agent | ReturnType<typeof request>, path: string) =>
  client.post(`/api/v1/auth${path}`).set('Origin', TRUSTED_ORIGIN);

const ADDRESS = 'new.client@example.com';
const details = { password: 'a long enough password', displayName: 'New Client' };

async function start(address = ADDRESS) {
  return post(request(app), '/signup/start').send({ email: address });
}

/** Moves the last send back in time, past the resend cooldown. */
const skipCooldown = () =>
  pool.query(`UPDATE email_verifications SET sent_at = now() - interval '2 minutes'`);

describe('POST /api/v1/auth/signup/start', () => {
  it('emails a 6-digit code and stores only a hash of it', async () => {
    const res = await start();

    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ email: ADDRESS, resendAfterSeconds: 60 });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: ADDRESS, subject: expect.stringContaining('code') });
    const code = email.lastCode()!;
    expect(code).toMatch(/^\d{6}$/);

    const { rows } = await pool.query('SELECT code_hash FROM email_verifications');
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].code_hash).not.toContain(code);
  });

  it('answers identically for an address that already has an account, and sends a note instead of a code', async () => {
    await createUser({ email: ADDRESS });

    const res = await start();

    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ email: ADDRESS, resendAfterSeconds: 60 });
    expect(email.sent[0]!.subject).toMatch(/already have/);
    expect(email.lastCode()).toBeUndefined();
  });

  it('makes the visitor wait before another code (429), then sends a new one that replaces the old', async () => {
    await start();
    const first = email.lastCode()!;

    const tooSoon = await start();
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error).toMatchObject({
      code: 'CODE_RESEND_TOO_SOON',
      details: { retryAfterSeconds: expect.any(Number) },
    });

    await skipCooldown();
    expect((await start()).status).toBe(202);
    const second = email.lastCode()!;

    const old = await post(request(app), '/signup/complete').send({
      email: ADDRESS,
      code: first === second ? '000000' : first,
      ...details,
    });
    expect(old.body.error.code).toBe('CODE_INCORRECT');
  });

  it('lets the visitor retry at once when the email could not be sent (503)', async () => {
    email.failOnce();

    const failed = await start();
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe('EMAIL_SEND_FAILED');

    expect((await start()).status).toBe(202);
  });

  it('is unavailable (503) when no email service is configured', async () => {
    const noEmail = createApp({ adapters: { email: null, google: null, payments: null } });

    const res = await post(request(noEmail), '/signup/start').send({ email: ADDRESS });
    const providers = await request(noEmail).get('/api/v1/auth/providers');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('EMAIL_SIGNUP_UNAVAILABLE');
    expect(providers.body.data).toEqual({ google: false, emailSignup: false });
  });

  it('is listed as available when an email service is configured', async () => {
    const providers = await request(app).get('/api/v1/auth/providers');

    expect(providers.body.data).toEqual({ google: false, emailSignup: true });
  });

  it('rejects an invalid email (400) and cross-site requests (403)', async () => {
    expect((await post(request(app), '/signup/start').send({ email: 'nope' })).status).toBe(400);
    const crossSite = await request(app)
      .post('/api/v1/auth/signup/start')
      .set('Origin', 'https://evil.example')
      .send({ email: ADDRESS });
    expect(crossSite.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
  });
});

describe('POST /api/v1/auth/signup/complete', () => {
  it('creates a verified client account, logs it in, and never returns the password hash', async () => {
    await start('  New.Client@Example.com ');
    const agent = request.agent(app);

    const res = await post(agent, '/signup/complete').send({
      email: 'NEW.client@example.com',
      code: email.lastCode(),
      ...details,
      role: 'admin', // ignored
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      email: ADDRESS,
      displayName: 'New Client',
      role: 'client',
      emailVerifiedAt: expect.any(String),
    });
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect((await agent.get('/api/v1/auth/session')).body.data.email).toBe(ADDRESS);

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE email = $1', [
      ADDRESS,
    ]);
    expect(await verifyPassword(details.password, rows[0].password_hash)).toBe(true);
    // The code is used up.
    expect((await pool.query('SELECT count(*)::int AS n FROM email_verifications')).rows[0].n).toBe(
      0,
    );
  });

  it(`counts wrong codes, and after ${MAX_ATTEMPTS} even the right code is refused`, async () => {
    await start();
    const right = email.lastCode()!;
    const wrong = right === '123456' ? '654321' : '123456';
    const attempt = (code: string) =>
      post(request(app), '/signup/complete').send({ email: ADDRESS, code, ...details });

    const first = await attempt(wrong);
    expect(first.status).toBe(422);
    expect(first.body.error).toMatchObject({
      code: 'CODE_INCORRECT',
      details: { remainingAttempts: MAX_ATTEMPTS - 1 },
    });
    for (let i = 1; i < MAX_ATTEMPTS - 1; i++) await attempt(wrong);
    expect((await attempt(wrong)).body.error.code).toBe('CODE_EXPIRED');

    expect((await attempt(right)).body.error.code).toBe('CODE_EXPIRED');
    expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(0);
  });

  it('refuses an expired code', async () => {
    await start();
    await pool.query(`UPDATE email_verifications SET expires_at = now() - interval '1 second'`);

    const res = await post(request(app), '/signup/complete').send({
      email: ADDRESS,
      code: email.lastCode(),
      ...details,
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('refuses a code sent to another address (codes are bound to their email)', async () => {
    await start('someone.else@example.com');

    const res = await post(request(app), '/signup/complete').send({
      email: ADDRESS,
      code: email.lastCode(),
      ...details,
    });

    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('lets the owner of an old, unverified account claim it with a code (same account, new password, other sessions signed out)', async () => {
    const old = await createUserWithPassword({ email: ADDRESS, emailVerifiedAt: null });
    // Whoever set the old password is still logged in somewhere.
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ('squatter', $1, now() + interval '1 day')`,
      [JSON.stringify({ cookie: {}, userId: old.id })],
    );
    await start();
    expect(email.lastCode()).toMatch(/^\d{6}$/);
    const agent = request.agent(app);

    const res = await post(agent, '/signup/complete').send({
      email: ADDRESS,
      code: email.lastCode(),
      ...details,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(old.id);
    expect((await pool.query(`SELECT 1 FROM sessions WHERE sid = 'squatter'`)).rowCount).toBe(0);
    expect((await agent.get('/api/v1/auth/session')).body.data.id).toBe(old.id);
    const { rows } = await pool.query(
      'SELECT password_hash, email_verified_at FROM users WHERE id = $1',
      [old.id],
    );
    expect(rows[0].email_verified_at).not.toBeNull();
    expect(await verifyPassword(old.password, rows[0].password_hash)).toBe(false);
    expect(await verifyPassword(details.password, rows[0].password_hash)).toBe(true);
  });

  it('validates the code format, password policy, and name (400)', async () => {
    const res = await post(request(app), '/signup/complete').send({
      email: ADDRESS,
      code: '12ab',
      password: 'short',
      displayName: '  ',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'code',
      'displayName',
      'password',
    ]);
  });
});

describe('POST /api/v1/auth/signup/complete: an address that already has an account', () => {
  it('never changes a verified account, even with a valid code (409 EMAIL_TAKEN)', async () => {
    const existing = await createUserWithPassword({ email: ADDRESS });
    // A valid code for this address can only exist if one was stored; plant one directly.
    const { hashCode } = await import('../../../lib/verificationCode.ts');
    const { config } = await import('../../../config/env.js');
    await pool.query(
      `INSERT INTO email_verifications (email, code_hash, expires_at)
       VALUES ($1, $2, now() + interval '5 minutes')`,
      [ADDRESS, hashCode(ADDRESS, '123456', config.authSecret)],
    );

    const res = await post(request(app), '/signup/complete').send({
      email: ADDRESS,
      code: '123456',
      ...details,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [
      existing.id,
    ]);
    expect(await verifyPassword(existing.password, rows[0].password_hash)).toBe(true);
  });
});
