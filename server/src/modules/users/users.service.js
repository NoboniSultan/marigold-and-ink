import * as usersRepository from './users.repository.js';
import { ConflictError, NotFoundError } from '../../errors/index.js';
import { isUniqueViolation } from '../../db/errors.js';
import { toLimitOffset, toPageMeta } from '../../lib/pagination.js';

export function findById(id) {
  return usersRepository.findById(id);
}

export async function getById(id) {
  const user = await usersRepository.findById(id);
  if (!user) throw new NotFoundError('User not found', { code: 'USER_NOT_FOUND' });
  return user;
}

/** Includes passwordHash. Only the auth service should call this. */
export function findByEmailWithPasswordHash(email) {
  return usersRepository.findByEmailWithPasswordHash(email);
}

/**
 * Creates a user. Uniqueness is enforced by the database constraint rather than a
 * "look up, then insert" check, which two simultaneous sign-ups could both pass.
 */
export async function createUser({ email, passwordHash, displayName, role = 'client' }) {
  try {
    return await usersRepository.insert({ email, passwordHash, displayName, role });
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_key')) {
      throw new ConflictError('An account with this email already exists', {
        code: 'EMAIL_TAKEN',
      });
    }
    throw err;
  }
}

export function upsertAdmin({ email, passwordHash, displayName }) {
  return usersRepository.upsertAdmin({ email, passwordHash, displayName });
}

export async function listUsers(pagination) {
  const { users, total } = await usersRepository.list(toLimitOffset(pagination));
  return { users, meta: toPageMeta(pagination, total) };
}
