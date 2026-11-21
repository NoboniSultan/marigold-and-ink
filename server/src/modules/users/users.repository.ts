import { pool } from '../../db/pool.js';

// Explicit column list: password_hash is never selected unless a function says so by name.
const PUBLIC_COLUMNS = 'id, email, display_name, role, created_at, updated_at';

/** Maps a database row to the domain shape used everywhere above this layer. */
function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findById(id, client = pool) {
  const { rows } = await client.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return toUser(rows[0]);
}

/** The only query that returns password_hash. Used by the auth service to check a login. */
export async function findByEmailWithPasswordHash(email, client = pool) {
  const { rows } = await client.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = $1`,
    [email],
  );
  const row = rows[0];
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export async function insert({ email, passwordHash, displayName, role }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING ${PUBLIC_COLUMNS}`,
    [email, passwordHash, displayName, role],
  );
  return toUser(rows[0]);
}

/**
 * Creates the admin account, or promotes an existing account with that email to admin.
 * An existing password is deliberately left unchanged, so re-running the seed never
 * resets a password the admin has since changed.
 * `xmax = 0` is a Postgres idiom that is true only when the row was freshly inserted.
 */
export async function upsertAdmin({ email, passwordHash, displayName }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO UPDATE SET role = 'admin'
     RETURNING ${PUBLIC_COLUMNS}, (xmax = 0) AS created`,
    [email, passwordHash, displayName],
  );
  return { user: toUser(rows[0]), created: rows[0].created };
}

export async function list({ limit, offset }, client = pool) {
  const { rows } = await client.query(
    `SELECT ${PUBLIC_COLUMNS}, count(*) OVER () AS total
     FROM users
     ORDER BY created_at DESC, id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  // count(*) OVER () returns the total matching rows alongside each page row, saving a
  // second query. An empty page has no rows to carry it, so fall back to a count query.
  const total = rows.length > 0 ? rows[0].total : await countAll(client);
  return { users: rows.map(toUser), total };
}

async function countAll(client) {
  const { rows } = await client.query('SELECT count(*) AS total FROM users');
  return rows[0].total;
}
