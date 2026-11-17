import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
export const MIGRATIONS_TABLE = 'pgmigrations';

/**
 * Applies or reverts SQL migrations in src/db/migrations.
 * Takes the database URL as an argument (no config import) so tests and the CLI
 * can point it at different databases.
 *
 * @param {object} options
 * @param {string} options.databaseUrl
 * @param {'up'|'down'} options.direction
 * @param {number} [options.count] how many migrations; defaults to all for up, 1 for down
 * @param {(msg: string) => void} [options.log]
 * @returns {Promise<string[]>} names of the migrations that ran
 */
export async function migrate({ databaseUrl, direction, count, log = () => {} }) {
  const ran = await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    migrationsTable: MIGRATIONS_TABLE,
    direction,
    count: count ?? (direction === 'up' ? Infinity : 1),
    // Refuse to run if a migration file was added "in the past" relative to ones already applied.
    checkOrder: true,
    log,
  });
  return ran.map((migration) => migration.name);
}
