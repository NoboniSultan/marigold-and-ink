import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

type Db = Pool | PoolClient;

export type Role = 'client' | 'admin';

/** A user as the app sees it (never the password hash). */
export interface UserRecord {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** For sign-in decisions only (the auth module). */
export interface AuthRecord extends UserRecord {
  passwordHash: string | null;
}

// Explicit column list: password_hash is never selected unless a function says so by name.
const PUBLIC_COLUMNS = 'id, email, display_name, role, email_verified_at, created_at, updated_at';

type Row = Record<string, unknown>;

/** Maps a database row to the domain shape used everywhere above this layer. */
function toUser(row: Row): UserRecord {
  return {
    id: row.id as number,
    email: row.email as string,
    displayName: row.display_name as string,
    role: row.role as Role,
    emailVerifiedAt: row.email_verified_at as Date | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

const firstUser = (rows: Row[]) => (rows[0] ? toUser(rows[0]) : null);

/** Deleted (anonymized) accounts are never returned: to the app they no longer exist. */
export async function findById(id: number, client: Db = pool): Promise<UserRecord | null> {
  const { rows } = await client.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return firstUser(rows);
}

/** The admin accounts (the owner), e.g. to tell them about a delivery problem. */
export async function findAdmins(client: Db = pool): Promise<UserRecord[]> {
  const { rows } = await client.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY id`,
  );
  return rows.map(toUser);
}

/** Several users at once (the admin commission list); deleted accounts are left out. */
export async function findByIds(ids: number[], client: Db = pool): Promise<UserRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await client.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
    [ids],
  );
  return rows.map(toUser);
}

/**
 * Like findForAuthByEmail, by ID: for confirming a signed-in user's password before a
 * password change or account deletion. Includes passwordHash, so only the auth module uses it.
 */
export async function findForAuthById(
  id: number,
  client: Db = pool,
  { forUpdate = false } = {},
): Promise<AuthRecord | null> {
  const { rows } = await client.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users
      WHERE id = $1 AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  const row = rows[0];
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export async function updateDisplayName(
  id: number,
  displayName: string,
  client: Db = pool,
): Promise<UserRecord | null> {
  const { rows } = await client.query(
    `UPDATE users SET display_name = $2 WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${PUBLIC_COLUMNS}`,
    [id, displayName],
  );
  return firstUser(rows);
}

export async function setPasswordHash(
  id: number,
  passwordHash: string,
  client: Db = pool,
): Promise<void> {
  await client.query('UPDATE users SET password_hash = $2 WHERE id = $1 AND deleted_at IS NULL', [
    id,
    passwordHash,
  ]);
}

/**
 * Moves an account to a new, just-proven email address (the code went to it), which also
 * counts as verifying it. Throws Postgres's unique violation if another account has it.
 */
export async function updateEmail(
  id: number,
  email: string,
  client: Db = pool,
): Promise<UserRecord | null> {
  const { rows } = await client.query(
    `UPDATE users SET email = $2, email_verified_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${PUBLIC_COLUMNS}`,
    [id, email],
  );
  return firstUser(rows);
}

/**
 * Account deletion (ADR 0012): removes everything that identifies the person and keeps
 * the row, because commissions and payments reference it for the owner's accounts.
 * users_deleted_fields_check guarantees nothing personal is left behind.
 */
export async function anonymize(id: number, client: Db = pool): Promise<void> {
  await client.query(
    `UPDATE users
        SET email = NULL, password_hash = NULL, email_verified_at = NULL,
            display_name = 'Deleted user', deleted_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
}

/**
 * For sign-in decisions (password check, verification state). Includes passwordHash, so
 * only the auth module uses it. `forUpdate` locks the row inside a transaction.
 */
export async function findForAuthByEmail(
  email: string,
  client: Db = pool,
  { forUpdate = false } = {},
): Promise<AuthRecord | null> {
  const { rows } = await client.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [email],
  );
  const row = rows[0];
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

/**
 * Lets the proven owner of an email take over an account that was never verified (one
 * created before verification existed, or by someone else using their email): sets a new
 * password and name and marks the email verified. Only ever touches unverified accounts,
 * so it returns null if the account was verified in the meantime.
 */
export async function claimUnverified(
  id: number,
  { passwordHash, displayName }: { passwordHash: string; displayName: string },
  client: Db = pool,
): Promise<UserRecord | null> {
  const { rows } = await client.query(
    `UPDATE users SET password_hash = $2, display_name = $3, email_verified_at = now()
      WHERE id = $1 AND email_verified_at IS NULL
      RETURNING ${PUBLIC_COLUMNS}`,
    [id, passwordHash, displayName],
  );
  return firstUser(rows);
}

/**
 * Google proved the email; an unverified account's password may have been set by someone
 * else (account pre-hijacking), so it is removed. The owner signs in with Google from now on.
 */
export async function verifyAndClearPassword(
  id: number,
  client: Db = pool,
): Promise<UserRecord | null> {
  const { rows } = await client.query(
    `UPDATE users SET password_hash = NULL, email_verified_at = now()
      WHERE id = $1 AND email_verified_at IS NULL
      RETURNING ${PUBLIC_COLUMNS}`,
    [id],
  );
  return firstUser(rows);
}

export async function insert(
  {
    email,
    passwordHash,
    displayName,
    role,
    emailVerifiedAt = null,
  }: {
    email: string;
    passwordHash: string | null;
    displayName: string;
    role: Role;
    emailVerifiedAt?: Date | null;
  },
  client: Db = pool,
): Promise<UserRecord> {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, display_name, role, email_verified_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${PUBLIC_COLUMNS}`,
    [email, passwordHash, displayName, role, emailVerifiedAt],
  );
  return toUser(rows[0]);
}

/**
 * Creates the admin account, or promotes an existing account with that email to admin.
 * An existing password is deliberately left unchanged, so re-running the seed never
 * resets a password the admin has since changed.
 * `xmax = 0` is a Postgres idiom that is true only when the row was freshly inserted.
 */
export async function upsertAdmin(
  {
    email,
    passwordHash,
    displayName,
  }: { email: string; passwordHash: string; displayName: string },
  client: Db = pool,
): Promise<{ user: UserRecord; created: boolean }> {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, display_name, role, email_verified_at)
     VALUES ($1, $2, $3, 'admin', now())
     ON CONFLICT (email) DO UPDATE
       SET role = 'admin',
           -- The admin email is the owner's own (ADMIN_EMAIL), so it counts as verified.
           email_verified_at = COALESCE(users.email_verified_at, now())
     RETURNING ${PUBLIC_COLUMNS}, (xmax = 0) AS created`,
    [email, passwordHash, displayName],
  );
  return { user: toUser(rows[0]), created: rows[0].created };
}

export async function list(
  { limit, offset }: { limit: number; offset: number },
  client: Db = pool,
): Promise<{ users: UserRecord[]; total: number }> {
  const { rows } = await client.query(
    `SELECT ${PUBLIC_COLUMNS}, count(*) OVER () AS total
     FROM users
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  // count(*) OVER () returns the total matching rows alongside each page row, saving a
  // second query. An empty page has no rows to carry it, so fall back to a count query.
  const total = rows.length > 0 ? rows[0].total : await countAll(client);
  return { users: rows.map(toUser), total };
}

async function countAll(client: Db): Promise<number> {
  const { rows } = await client.query(
    'SELECT count(*) AS total FROM users WHERE deleted_at IS NULL',
  );
  return rows[0].total;
}
