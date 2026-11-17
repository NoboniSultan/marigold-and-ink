import { pool } from '../../db/pool.js';

/** Round-trips a trivial query to prove the database is reachable. */
export async function ping(client = pool) {
  await client.query('SELECT 1');
}
