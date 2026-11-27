import { logger as defaultLogger } from '../lib/logger.js';

/**
 * Paths whose query string carries secrets and is never logged. Google's callback brings a
 * sign-in code and state; they're single-use, but logs are kept longer and seen more widely
 * than the sign-in they belong to. Shippo's webhook link carries its secret token.
 */
const SECRET_QUERY_PATHS = new Set([
  '/api/v1/auth/google/callback',
  '/api/v1/webhooks/shippo',
  '/api/v1/webhooks/shippo/',
]);

/** The URL to log: as requested, but with the query string hidden on SECRET_QUERY_PATHS. */
export function loggablePath(originalUrl) {
  const queryStart = originalUrl.indexOf('?');
  if (queryStart === -1) return originalUrl;
  const path = originalUrl.slice(0, queryStart);
  return SECRET_QUERY_PATHS.has(path) ? `${path}?[REDACTED]` : originalUrl;
}

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
          path: loggablePath(req.originalUrl),
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
        },
        'request completed',
      );
    });

    next();
  };
}
