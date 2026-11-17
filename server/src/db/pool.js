import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * The single connection pool for the whole process. Repositories use it by default;
 * withTransaction() borrows one client from it so several queries share a transaction.
 */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// An idle client can lose its connection (e.g. the database restarts). Without this
// listener pg would emit an unhandled 'error' event and crash the process.
pool.on('error', (err) => {
  logger.error({ err }, 'idle database client error');
});
