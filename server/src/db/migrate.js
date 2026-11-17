/**
 * CLI: npm run migrate:up            apply all pending migrations
 *      npm run migrate:down          revert the most recent migration
 *      npm run migrate:down -- 3     revert the last 3
 *      npm run migrate:down -- all   revert everything
 * Uses the validated config, so NODE_ENV=test targets TEST_DATABASE_URL.
 */
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { migrate } from './migrator.js';

const [direction, countArg] = process.argv.slice(2);

if (direction !== 'up' && direction !== 'down') {
  logger.fatal('usage: node src/db/migrate.js <up|down> [count|all]');
  process.exit(1);
}

let count;
if (countArg === 'all') count = Infinity;
else if (countArg !== undefined) {
  count = Number(countArg);
  if (!Number.isInteger(count) || count < 1) {
    logger.fatal({ countArg }, 'count must be a positive integer or "all"');
    process.exit(1);
  }
}

try {
  const ran = await migrate({ databaseUrl: config.databaseUrl, direction, count });
  logger.info(
    { direction, env: config.nodeEnv, migrations: ran },
    ran.length ? `migrated ${direction}: ${ran.length} migration(s)` : 'no migrations to run',
  );
} catch (err) {
  logger.fatal({ err }, `migration ${direction} failed`);
  process.exitCode = 1;
}
