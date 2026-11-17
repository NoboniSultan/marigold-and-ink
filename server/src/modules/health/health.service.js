import * as healthRepository from './health.repository.js';
import { ServiceUnavailableError } from '../../errors/index.js';
import { logger } from '../../lib/logger.js';

/**
 * Reports whether the app and its dependencies are usable. A hosting platform's
 * health check treats any non-2xx response as unhealthy, so a failed database ping
 * becomes a 503 instead of a 200 with "down" in the body.
 */
export async function getHealth() {
  try {
    await healthRepository.ping();
  } catch (err) {
    logger.warn({ err }, 'health check: database ping failed');
    throw new ServiceUnavailableError('Database is unavailable', {
      details: { checks: { database: 'down' } },
    });
  }

  return {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks: { database: 'ok' },
  };
}
