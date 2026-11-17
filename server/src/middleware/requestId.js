import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '../lib/requestContext.js';

// Accept an incoming ID (e.g. from a load balancer) only if it is short and safe to log.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Gives every request an ID, returns it in the X-Request-Id response header,
 * and runs the rest of the request inside a context that the logger reads from.
 */
export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  req.id = id;
  res.set('X-Request-Id', id);
  runWithRequestContext({ requestId: id }, next);
}
