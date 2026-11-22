import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import type { GoogleAuth, GoogleChecks, GoogleProfile } from '../../../adapters/googleOidc.ts';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  createIdentity,
  createUser,
  createUserWithPassword,
} from '../../../../tests/factories/index.js';
import { TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';

/**
 * A stand-in for Google. Like the real library, `finish` refuses a callback whose state
 * doesn't match the one stored when the sign-in started; it then "verifies" whatever
 * profile the test set.
 */
function fakeGoogle() {
  let profile: GoogleProfile = {
    sub: 'google-sub-1',
    email: 'ana@gmail.com',
    emailVerified: true,
    name: 'Ana Lima',
  };
  let counter = 0;
  const google: GoogleAuth = {
    async start() {
      counter += 1;
      const checks: GoogleChecks = {
        state: `state-${counter}`,
        nonce: `nonce-${counter}`,
        codeVerifier: `verifier-${counter}`,
      };
      return { url: `https://accounts.google.test/auth?state=${checks.state}`, checks };
    },
    async finish(callbackUrl: URL, checks: GoogleChecks) {
      if (callbackUrl.searchParams.get('state') !== checks.state) {
        throw new Error('state mismatch');
      }
      return profile;
    },
  };
  return {
    google,
    setProfile: (changes: Partial<GoogleProfile>) => {
      profile = { ...profile, ...changes };
    },
  };
}

let fake: ReturnType<typeof fakeGoogle>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await truncateAllTables();
  fake = fakeGoogle();
  app = createApp({ adapters: { email: null, google: fake.google } });
});

/** Runs the browser's side of the flow: start, then Google redirects back to the callback. */
async function signIn(
  agent = request.agent(app),
  { next = '/commission', state }: { next?: string; state?: string } = {},
) {
  const started = await agent.get(`/api/v1/auth/google/start?next=${encodeURIComponent(next)}`);
  const googleUrl = new URL(started.headers.location!);
  const callback = await agent.get(
    `/api/v1/auth/google/callback?code=one-time-code&state=${state ?? googleUrl.searchParams.get('state')}`,
  );
  return { agent, started, callback };
}

const sessionUser = async (agent: request.Agent) =>
  (await agent.get('/api/v1/auth/session')).body.data;

const countUsers = async () => (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;

describe('Google sign-in', () => {
  it('sends the visitor to Google, then creates a verified account with no password', async () => {
    const { agent, started, callback } = await signIn();

    expect(started.status).toBe(303);
    expect(started.headers.location).toMatch(/^https:\/\/accounts\.google\.test\//);
    expect(callback.status).toBe(303);
    expect(callback.headers.location).toBe('/commission');

    expect(await sessionUser(agent)).toMatchObject({
      email: 'ana@gmail.com',
      displayName: 'Ana Lima',
      role: 'client',
      emailVerifiedAt: expect.any(String),
    });
    const { rows } = await pool.query(
      `SELECT u.password_hash, i.provider, i.provider_user_id
         FROM users u JOIN auth_identities i ON i.user_id = u.id`,
    );
    expect(rows).toEqual([
      { password_hash: null, provider: 'google', provider_user_id: 'google-sub-1' },
    ]);
  });

  it('signs a returning visitor in to the same account, matched by Google ID even if the email changed', async () => {
    const first = await signIn();
    const userId = (await sessionUser(first.agent)).id;
    fake.setProfile({ email: 'ana.new@gmail.com' });

    const second = await signIn();

    expect((await sessionUser(second.agent)).id).toBe(userId);
    expect(await countUsers()).toBe(1);
  });

  it('links to an existing verified account with the same email, keeping its password', async () => {
    const existing = await createUserWithPassword({ email: 'ana@gmail.com' });

    const { agent } = await signIn();

    expect((await sessionUser(agent)).id).toBe(existing.id);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ email: existing.email, password: existing.password });
    expect(login.status).toBe(200);
  });

  it('links an old unverified account but removes its password and signs out its other sessions', async () => {
    const existing = await createUserWithPassword({
      email: 'ana@gmail.com',
      emailVerifiedAt: null,
    });
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ('squatter', $1, now() + interval '1 day')`,
      [JSON.stringify({ cookie: {}, userId: existing.id })],
    );

    const { agent } = await signIn();

    expect((await sessionUser(agent)).id).toBe(existing.id);
    const { rows } = await pool.query(
      'SELECT password_hash, email_verified_at FROM users WHERE id = $1',
      [existing.id],
    );
    expect(rows[0].password_hash).toBeNull();
    expect(rows[0].email_verified_at).not.toBeNull();
    const squatter = await pool.query(`SELECT 1 FROM sessions WHERE sid = 'squatter'`);
    expect(squatter.rowCount).toBe(0);
  });

  it('refuses an email Google has not verified', async () => {
    fake.setProfile({ emailVerified: false });

    const { agent, callback } = await signIn();

    expect(callback.headers.location).toBe('/login?error=google_unverified_email');
    expect(await sessionUser(agent)).toBeNull();
    expect(await countUsers()).toBe(0);
  });

  it('refuses a callback whose state does not match (forged or from another browser)', async () => {
    const { agent, callback } = await signIn(undefined, { state: 'attacker-state' });

    expect(callback.headers.location).toBe('/login?error=google_failed');
    expect(await sessionUser(agent)).toBeNull();
  });

  it('refuses a callback this browser never started', async () => {
    const res = await request(app).get('/api/v1/auth/google/callback?code=x&state=state-1');

    expect(res.headers.location).toBe('/login?error=google_failed');
    expect(await countUsers()).toBe(0);
  });

  it('accepts each callback only once (no replay)', async () => {
    const agent = request.agent(app);
    const started = await agent.get('/api/v1/auth/google/start');
    const state = new URL(started.headers.location!).searchParams.get('state');
    const callback = `/api/v1/auth/google/callback?code=one-time-code&state=${state}`;

    await agent.get(callback);
    await agent.post('/api/v1/auth/logout').set('Origin', TRUSTED_ORIGIN);
    const replay = await agent.get(callback);

    expect(replay.headers.location).toBe('/login?error=google_failed');
  });

  it('refuses a sign-in that took longer than 10 minutes', async () => {
    const agent = request.agent(app);
    const started = await agent.get('/api/v1/auth/google/start');
    const state = new URL(started.headers.location!).searchParams.get('state');
    const later = Date.now() + 11 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);

    const res = await agent.get(`/api/v1/auth/google/callback?code=x&state=${state}`);

    expect(res.headers.location).toBe('/login?error=google_failed');
  });

  it('tells the visitor when they cancelled on Google', async () => {
    const agent = request.agent(app);
    await agent.get('/api/v1/auth/google/start');

    const res = await agent.get('/api/v1/auth/google/callback?error=access_denied');

    expect(res.headers.location).toBe('/login?error=google_cancelled');
  });

  it('never signs in an admin with Google, by email or by a linked identity', async () => {
    const admin = await createUser({ email: 'ana@gmail.com', role: 'admin' });

    const byEmail = await signIn();
    expect(byEmail.callback.headers.location).toBe('/login?error=google_admin');

    await createIdentity({ userId: admin.id, providerUserId: 'google-sub-1' });
    const byIdentity = await signIn();
    expect(byIdentity.callback.headers.location).toBe('/login?error=google_admin');
    expect(await sessionUser(byIdentity.agent)).toBeNull();
  });

  it('refuses to link an account that already has a different Google account', async () => {
    const existing = await createUser({ email: 'ana@gmail.com' });
    await createIdentity({ userId: existing.id, providerUserId: 'another-google-account' });

    const { callback } = await signIn();

    expect(callback.headers.location).toBe('/login?error=google_account_conflict');
  });

  it.each([
    '//evil.example/steal',
    '/\\evil.example/steal', // browsers read the backslash as a slash
    '/\t/evil.example/steal', // browsers drop tabs from URLs
    'https://evil.example/steal',
  ])('only returns to pages on this site (refuses %j)', async (next) => {
    const { callback } = await signIn(undefined, { next });

    expect(callback.headers.location).toBe('/');
  });

  it('returns to a same-site page with its query string', async () => {
    const { callback } = await signIn(undefined, { next: '/gallery?tag=floral&page=2' });

    expect(callback.headers.location).toBe('/gallery?tag=floral&page=2');
  });

  it('is off when Google is not configured', async () => {
    const off = createApp({ adapters: { email: null, google: null } });

    const start = await request(off).get('/api/v1/auth/google/start');
    const providers = await request(off).get('/api/v1/auth/providers');

    expect(start.headers.location).toBe('/login?error=google_unavailable');
    expect(providers.body.data.google).toBe(false);
  });
});
