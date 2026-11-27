import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { pool } from './db/pool.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;
/** How often expired files are swept (ADR 0016); also once at startup. */
const FILE_SWEEP_MS = 24 * 60 * 60 * 1000;
/** How often packages on their way are checked with Shippo; also once at startup. */
const TRACKING_CHECK_MS = 24 * 60 * 60 * 1000;

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'server listening');
  // Tree requests that didn't go through before the last restart are retried now.
  app.locals.requestPendingTrees();
  // Files past their keeping period are deleted now, then once a day. (The free Render
  // plan also restarts the server often, so this runs at least that often.)
  app.locals.purgeExpiredFiles();
  setInterval(() => app.locals.purgeExpiredFiles(), FILE_SWEEP_MS).unref();
  // Packages on their way are checked now, then once a day, in case a tracking webhook
  // from Shippo was missed (milestone 11b). Never throws.
  app.locals.refreshTracking();
  setInterval(() => app.locals.refreshTracking(), TRACKING_CHECK_MS).unref();
});

/**
 * Graceful shutdown: stop accepting new connections, let in-flight requests finish,
 * then close the session store and the database pool. Hosting platforms send SIGTERM before replacing an
 * instance; Ctrl+C sends SIGINT.
 */
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');

  // If something hangs, exit anyway rather than blocking a deploy forever.
  setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close(async (serverErr) => {
    try {
      // Stop the session store's cleanup timer before closing the pool it uses.
      await app.locals.sessionStore.close();
      await pool.end();
    } catch (poolErr) {
      logger.error({ err: poolErr }, 'error closing database pool');
      process.exit(1);
    }
    if (serverErr) logger.error({ err: serverErr }, 'error closing HTTP server');
    process.exit(serverErr ? 1 : 0);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
