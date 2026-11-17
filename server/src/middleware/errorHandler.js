import { AppError } from '../errors/index.js';
import { logger as defaultLogger } from '../lib/logger.js';

// Errors raised by Express's body parser before our code runs. They carry an
// `expose` flag and a `type`; we map the ones a client can cause to stable codes.
const BODY_PARSER_ERROR_CODES = {
  'entity.parse.failed': 'INVALID_JSON',
  'entity.too.large': 'PAYLOAD_TOO_LARGE',
  'encoding.unsupported': 'UNSUPPORTED_ENCODING',
  'charset.unsupported': 'UNSUPPORTED_ENCODING',
};

function toErrorResponse(err) {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }

  if (err.expose && err.status >= 400 && err.status < 500) {
    return {
      status: err.status,
      code: BODY_PARSER_ERROR_CODES[err.type] ?? 'BAD_REQUEST',
      message: err.message,
    };
  }

  // Anything else is a bug or an infrastructure failure. Never send its message,
  // stack trace, or SQL details to the client; they go to the logs only.
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
}

/**
 * The single place where errors become HTTP responses. Controllers and services
 * just throw; Express 5 forwards thrown and rejected errors here automatically.
 */
export function errorHandler({ logger = defaultLogger } = {}) {
  // Express recognises error handlers by their four parameters.
  return (err, req, res, next) => {
    // If a response is already streaming we cannot send JSON; let Express close the connection.
    if (res.headersSent) return next(err);

    const { status, code, message, details } = toErrorResponse(err);

    // AppErrors (even 5xx ones like a 503 health check) and client-caused body parser
    // errors are deliberate outcomes; the request logger already records their status.
    // Only errors nobody anticipated get logged here, with their stack trace.
    const isAnticipated = err instanceof AppError || err.expose === true;
    if (!isAnticipated) {
      logger.error({ err, requestId: req.id }, 'unhandled error');
    }

    const body = { error: { code, message } };
    if (details !== undefined) body.error.details = details;

    res.status(status).json(body);
  };
}
