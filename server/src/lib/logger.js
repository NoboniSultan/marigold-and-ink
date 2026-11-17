import pino from 'pino';
import { config } from '../config/env.js';
import { getRequestContext } from './requestContext.js';

const REDACT_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'authorization',
  'cookie',
];

/**
 * Builds a pino logger. Every line logged while handling a request automatically
 * includes that request's ID (via the mixin), wherever in the code it was logged from.
 * `destination` lets tests capture output.
 */
export function createLogger({ level = config.logLevel, pretty = false, destination } = {}) {
  const options = {
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    mixin() {
      const context = getRequestContext();
      return context ? { requestId: context.requestId } : {};
    },
  };

  if (pretty) {
    options.transport = { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } };
  }

  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger({ pretty: config.nodeEnv === 'development' });
