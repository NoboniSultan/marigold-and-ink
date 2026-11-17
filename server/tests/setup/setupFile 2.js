import { afterAll } from 'vitest';
import { pool } from '../../src/db/pool.js';

// Runs inside each test file. Each file gets its own module instances (and pool),
// so close the pool when the file finishes to avoid leaked connections.
afterAll(async () => {
  await pool.end();
});
