import * as usersService from '../modules/users/users.service.ts';
import { UnauthorizedError, ForbiddenError } from '../errors/index.js';
import { assertCanAccessOwnedResource } from '../lib/authorization.js';
import { destroySession } from '../lib/session.js';

/**
 * Requires a logged-in user and loads them onto `req.user`.
 * The user is re-read from the database on every request (not trusted from the session),
 * so a role change or a deleted account takes effect immediately.
 */
export async function requireAuth(req, _res, next) {
  const userId = req.session?.userId;
  if (!userId) throw new UnauthorizedError();

  const user = await usersService.findById(userId);
  if (!user) {
    await destroySession(req); // the account no longer exists; drop the dangling session
    throw new UnauthorizedError();
  }

  req.user = user;
  next();
}

/** Use after requireAuth: `requireRole('admin')`. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) throw new UnauthorizedError();
    if (!roles.includes(req.user.role)) throw new ForbiddenError();
    next();
  };
}

/**
 * Use after requireAuth. `getOwnerId(req)` returns (or resolves to) the ID of the user
 * who owns the requested resource; clients may only proceed if it is theirs, admins always.
 *
 *   requireOwnerOrAdmin((req) => req.validated.params.id)                        // a user record
 *   requireOwnerOrAdmin((req) => commissionsService.getOwnerId(req.params.id))   // milestone 4
 */
export function requireOwnerOrAdmin(getOwnerId) {
  return async (req, _res, next) => {
    if (!req.user) throw new UnauthorizedError();
    const ownerId = await getOwnerId(req);
    assertCanAccessOwnedResource(req.user, ownerId);
    next();
  };
}
