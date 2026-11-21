/**
 * SQL for the auth module's tables: email_verifications (pending sign-up codes),
 * auth_identities (Google accounts linked to users), and sessions (to sign a user out
 * everywhere). Every function accepts an optional transaction client.
 */
import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

type Db = Pool | PoolClient;

export interface Verification {
  email: string;
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
 * Stores a new code for `email`, replacing any earlier one, unless a code was sent less
 * than `cooldownMs` ago. Returns false when the cooldown blocked it. One statement, so two
 * simultaneous requests can't both slip past the cooldown.
 */
export async function saveVerification(
  {
    email,
    codeHash,
    expiresAt,
    cooldownMs,
  }: {
    email: string;
    codeHash: string;
    expiresAt: Date;
    cooldownMs: number;
  },
  client: Db = pool,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `INSERT INTO email_verifications (email, code_hash, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
           attempts = 0, sent_at = now()
       WHERE email_verifications.sent_at <= now() - make_interval(secs => $4)`,
    [email, codeHash, expiresAt, cooldownMs / 1000],
  );
  return (rowCount ?? 0) > 0;
}

/** Seconds until another code may be sent to `email` (0 if now). */
export async function secondsUntilResend(
  email: string,
  cooldownMs: number,
  client: Db = pool,
): Promise<number> {
  const { rows } = await client.query(
    `SELECT GREATEST(0, ceil(extract(epoch FROM
              (sent_at + make_interval(secs => $2)) - now())))::int AS seconds
       FROM email_verifications WHERE email = $1`,
    [email, cooldownMs / 1000],
  );
  return rows[0]?.seconds ?? 0;
}

export async function findVerification(
  email: string,
  client: Db = pool,
  { forUpdate = false } = {},
): Promise<Verification | null> {
  const { rows } = await client.query(
    `SELECT email, code_hash, attempts, expires_at, sent_at
       FROM email_verifications WHERE email = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [email],
  );
  const row = rows[0];
  return row
    ? {
        email: row.email,
        codeHash: row.code_hash,
        attempts: row.attempts,
        expiresAt: row.expires_at,
        sentAt: row.sent_at,
      }
    : null;
}

export async function recordFailedAttempt(email: string, client: Db = pool): Promise<void> {
  await client.query('UPDATE email_verifications SET attempts = attempts + 1 WHERE email = $1', [
    email,
  ]);
}

export async function deleteVerification(email: string, client: Db = pool): Promise<void> {
  await client.query('DELETE FROM email_verifications WHERE email = $1', [email]);
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
