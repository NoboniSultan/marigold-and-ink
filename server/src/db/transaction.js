import { pool } from './pool.js';

/**
 * Runs `fn(client)` inside a database transaction.
 * - Commits and returns fn's result if it resolves.
 * - Rolls back and rethrows the original error if it throws.
 * - Always returns the client to the pool.
 *
 * Usage:
 *   await withTransaction(async (client) => {
 *     await commissionsRepository.updateStatus(id, status, client);
 *     await commissionsRepository.insertEvent(event, client);
 *   });
 *
 * `db` is injectable for tests; production code uses the shared pool.
 */
export async function withTransaction(fn, { db = pool } = {}) {
  const client = await db.connect();
  let releaseError;

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
      releaseError = rollbackErr;
    }
    throw err;
  } finally {
    client.release(releaseError);
  }
}
