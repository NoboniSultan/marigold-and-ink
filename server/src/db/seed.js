/**
 * CLI: npm run seed
 * Runs every seed in order. Each seed must be idempotent (safe to run repeatedly),
 * because the deploy runs this on every start.
 */
import { logger } from '../lib/logger.js';
import { pool } from './pool.js';
import { seedAdmin } from './seeds/admin.js';

try {
  const admin = await seedAdmin();
  if (admin.skipped) logger.warn({ reason: admin.reason }, 'admin seed skipped');
  else logger.info({ userId: admin.userId, created: admin.created }, 'admin seed done');
} catch (err) {
  logger.fatal({ err }, 'seed failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
