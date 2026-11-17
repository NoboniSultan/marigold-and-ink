import { logger as defaultLogger } from '../lib/logger.js';

/**
 * Logs one line per request when the response finishes: method, path, status, duration.
 * 5xx responses log at error level, 4xx at warn, everything else at info.
 */
export function requestLogger({ logger = defaultLogger } = {}) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      logger[level](
        {
          requestId: req.id,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
        },
        'request completed',
      );
    });

    next();
  };
}
