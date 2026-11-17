import { NotFoundError } from '../errors/index.js';

/** Catches any request that no route matched and hands a 404 to the error handler. */
export function notFound(req, _res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`, { code: 'ROUTE_NOT_FOUND' }));
}
