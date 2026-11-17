import { pool } from '../../src/db/pool.js';

// Tables that hold schema state rather than test data.
const PRESERVED_TABLES = new Set(['pgmigrations']);

/**
 * Empties every application table in the test database and resets ID sequences.
 * Integration test files call this in beforeEach so every test starts clean:
 *   beforeEach(truncateAllTables);
 */
export async function truncateAllTables() {
  const { rows } = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const tables = rows.map((r) => r.tablename).filter((name) => !PRESERVED_TABLES.has(name));
  if (tables.length === 0) return;

  const quoted = tables.map((name) => `"${name}"`).join(', ');
  await pool.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
}
