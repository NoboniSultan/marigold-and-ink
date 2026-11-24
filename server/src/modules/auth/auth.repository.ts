/**
 * SQL for the auth module's tables: email_verifications (pending emailed codes, for sign-up,
 * password reset, and email change), auth_identities (Google accounts linked to users), and
 * sessions (to sign a user out everywhere). Every function accepts an optional transaction
 * client.
 */
import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

type Db = Pool | PoolClient;

/** What an emailed code proves (ADR 0014). Each keeps at most one code per address. */
export type CodePurpose = 'signup' | 'password_reset' | 'email_change';

export interface Verification {
  purpose: CodePurpose;
  email: string;
  /** The account an email-change code is for; null for the other purposes. */
  userId: number | null;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  sentAt: Date;
}

export interface Identity {
  id: number;
  userId: number;
  provider: 'google';
  providerUserId: string;
}

/**
 * Stores a new code for `email` and `purpose`, replacing any earlier one, unless a code was
 * sent less than `cooldownMs` ago. Returns false when the cooldown blocked it. One
 * statement, so two simultaneous requests can't both slip past the cooldown.
 */
export async function saveVerification(
  {
    purpose,
    email,
    userId = null,
    codeHash,
    expiresAt,
    cooldownMs,
  }: {
    purpose: CodePurpose;
    email: string;
    userId?: number | null;
    codeHash: string;
    expiresAt: Date;
    cooldownMs: number;
  },
  client: Db = pool,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `INSERT INTO email_verifications (purpose, email, user_id, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (purpose, email) DO UPDATE
       SET user_id = EXCLUDED.user_id, code_hash = EXCLUDED.code_hash,
           expires_at = EXCLUDED.expires_at, attempts = 0, sent_at = now()
       WHERE email_verifications.sent_at <= now() - make_interval(secs => $6)`,
    [purpose, email, userId, codeHash, expiresAt, cooldownMs / 1000],
  );
  return (rowCount ?? 0) > 0;
}

/** Seconds until another `purpose` code may be sent to `email` (0 if now). */
export async function secondsUntilResend(
  purpose: CodePurpose,
  email: string,
  cooldownMs: number,
  client: Db = pool,
): Promise<number> {
  const { rows } = await client.query(
    `SELECT GREATEST(0, ceil(extract(epoch FROM
              (sent_at + make_interval(secs => $3)) - now())))::int AS seconds
       FROM email_verifications WHERE purpose = $1 AND email = $2`,
    [purpose, email, cooldownMs / 1000],
  );
  return rows[0]?.seconds ?? 0;
}

export async function findVerification(
  purpose: CodePurpose,
  email: string,
  client: Db = pool,
  { forUpdate = false } = {},
): Promise<Verification | null> {
  const { rows } = await client.query(
    `SELECT purpose, email, user_id, code_hash, attempts, expires_at, sent_at
       FROM email_verifications
      WHERE purpose = $1 AND email = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [purpose, email],
  );
  const row = rows[0];
  return row
    ? {
        purpose: row.purpose,
        email: row.email,
        userId: row.user_id === null ? null : Number(row.user_id),
        codeHash: row.code_hash,
        attempts: row.attempts,
        expiresAt: row.expires_at,
        sentAt: row.sent_at,
      }
    : null;
}

export async function recordFailedAttempt(
  purpose: CodePurpose,
  email: string,
  client: Db = pool,
): Promise<void> {
  await client.query(
    'UPDATE email_verifications SET attempts = attempts + 1 WHERE purpose = $1 AND email = $2',
    [purpose, email],
  );
}

export async function deleteVerification(
  purpose: CodePurpose,
  email: string,
  client: Db = pool,
): Promise<void> {
  await client.query('DELETE FROM email_verifications WHERE purpose = $1 AND email = $2', [
    purpose,
    email,
  ]);
}

/** Account deletion: every pending code for the account's address, and its email change. */
export async function deleteVerificationsForUser(
  userId: number,
  email: string,
  client: Db = pool,
): Promise<void> {
  await client.query('DELETE FROM email_verifications WHERE user_id = $1 OR email = $2', [
    userId,
    email,
  ]);
}

/**
 * Removes codes that can no longer be used. Run before each new code is stored, so a code
 * nobody entered doesn't keep its email address in the database for long. Expiry (15
 * minutes) outlasts the resend cooldown (1 minute), so this never lifts a cooldown early.
 */
export async function deleteExpiredVerifications(client: Db = pool): Promise<number> {
  const { rowCount } = await client.query(
    'DELETE FROM email_verifications WHERE expires_at <= now()',
  );
  return rowCount ?? 0;
}

export async function findIdentity(
  provider: 'google',
  providerUserId: string,
  client: Db = pool,
): Promise<Identity | null> {
  const { rows } = await client.query(
    `SELECT id, user_id, provider, provider_user_id FROM auth_identities
      WHERE provider = $1 AND provider_user_id = $2`,
    [provider, providerUserId],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        provider: row.provider,
        providerUserId: row.provider_user_id,
      }
    : null;
}

export async function insertIdentity(
  {
    userId,
    provider,
    providerUserId,
    email,
  }: {
    userId: number;
    provider: 'google';
    providerUserId: string;
    email: string | null;
  },
  client: Db = pool,
): Promise<void> {
  await client.query(
    `INSERT INTO auth_identities (user_id, provider, provider_user_id, email)
     VALUES ($1, $2, $3, $4)`,
    [userId, provider, providerUserId, email],
  );
}

/** Signs a user out everywhere: their sessions are rows holding their userId. */
export async function deleteSessionsForUser(userId: number, client: Db = pool): Promise<number> {
  const { rowCount } = await client.query(
    `DELETE FROM sessions WHERE (sess->>'userId')::bigint = $1`,
    [userId],
  );
  return rowCount ?? 0;
}

/** The providers linked to a user (today only 'google'), for the account page. */
export async function listProvidersForUser(userId: number, client: Db = pool): Promise<string[]> {
  const { rows } = await client.query(
    'SELECT DISTINCT provider FROM auth_identities WHERE user_id = $1 ORDER BY provider',
    [userId],
  );
  return rows.map((row) => row.provider as string);
}

/** Account deletion: unlinks Google, which also removes the Google email kept here. */
export async function deleteIdentitiesForUser(userId: number, client: Db = pool): Promise<void> {
  await client.query('DELETE FROM auth_identities WHERE user_id = $1', [userId]);
}
