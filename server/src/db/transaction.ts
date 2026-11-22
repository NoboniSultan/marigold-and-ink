import type { Pool, PoolClient } from 'pg';
import { pool } from './pool.js';

/**
 * Runs `fn(client)` inside a database transaction.
 * - Commits and returns fn's result if it resolves.
 * - Rolls back and rethrows the original error if it throws.
 * - Always returns the client to the pool.
 *
 * Usage:
 *   await withTransaction(async (client) => {
 *     await commissionsRepository.update(id, { status }, client);
 *     await commissionsRepository.insertEvent(event, client);
 *   });
 *
 * Generic over T: whatever `fn` resolves to is what withTransaction resolves to, so
 * `const id = await withTransaction(async (tx) => 42)` is typed as a number.
 *
 * `db` is injectable for tests; production code uses the shared pool.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  { db = pool }: { db?: Pick<Pool, 'connect'> } = {},
): Promise<T> {
  const client = await db.connect();
  let releaseError: Error | undefined;

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // The connection is in an unknown state; tell the pool to destroy it, not reuse it.
      releaseError = rollbackErr as Error;
    }
    throw err;
  } finally {
    client.release(releaseError);
  }
}
