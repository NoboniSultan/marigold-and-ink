import * as usersService from '../users/users.service.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { UnauthorizedError } from '../../errors/index.js';

// Compared against when the email doesn't exist, so a login attempt takes the same time
// whether or not the account exists. Otherwise response timing would reveal which
// emails are registered. Created lazily (with the configured cost) and reused.
let dummyHashPromise;
function dummyHash() {
  dummyHashPromise ??= hashPassword('timing-equalizer-not-a-real-password');
  return dummyHashPromise;
}

export async function register({ email, password, displayName }) {
  const passwordHash = await hashPassword(password);
  return usersService.createUser({ email, passwordHash, displayName, role: 'client' });
}

/** Returns the user (without passwordHash) or throws 401 INVALID_CREDENTIALS. */
export async function login({ email, password }) {
  const record = await usersService.findByEmailWithPasswordHash(email);
  const passwordMatches = await verifyPassword(
    password,
    record?.passwordHash ?? (await dummyHash()),
  );

  if (!record || !passwordMatches) {
    // The same message for "no such email" and "wrong password" so accounts can't be probed.
    throw new UnauthorizedError('Invalid email or password', { code: 'INVALID_CREDENTIALS' });
  }

  const { passwordHash: _omit, ...user } = record;
  return user;
}

/** Used by the admin seed: creates the admin, or promotes an existing account. */
export async function ensureAdmin({ email, password, displayName }) {
  const passwordHash = await hashPassword(password);
  return usersService.upsertAdmin({ email, passwordHash, displayName });
}
