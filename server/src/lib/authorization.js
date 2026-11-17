import { ForbiddenError } from '../errors/index.js';

/**
 * Pure ownership rule used across modules: admins can access everything,
 * clients only resources they own. Kept free of HTTP and database access so
 * services can call it after loading a resource, and it can be unit tested directly.
 */
export function canAccessOwnedResource(user, ownerId) {
  if (!user) return false;
  return user.role === 'admin' || user.id === ownerId;
}

export function assertCanAccessOwnedResource(user, ownerId) {
  if (!canAccessOwnedResource(user, ownerId)) {
    throw new ForbiddenError();
  }
}
