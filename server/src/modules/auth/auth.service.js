import * as usersService from '../users/users.service.ts';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { ForbiddenError, UnauthorizedError } from '../../errors/index.js';

/**
 * The user behind a session, or null. Used by GET /auth/session, where "not logged in" is
 * a normal answer (200 with null), not an error: the site asks on every page load.
 */
export async function getSessionUser(userId) {
  if (!userId) return null;
  return (await usersService.findById(userId)) ?? null;
}

// Compared against when the email doesn't exist, so a login attempt takes the same time
// whether or not the account exists. Otherwise response timing would reveal which
// emails are registered. Created lazily (with the configured cost) and reused.
let dummyHashPromise;
function dummyHash() {
  dummyHashPromise ??= hashPassword('timing-equalizer-not-a-real-password');
  return dummyHashPromise;
}

/**
 * Returns the user (without passwordHash), or throws 401 INVALID_CREDENTIALS, or 403
 * EMAIL_NOT_VERIFIED for an account whose email was never verified.
 * (Sign-up lives in auth.signup.service.ts; accounts are created only after an emailed code.)
 */
export async function login({ email, password }) {
  const record = await usersService.findForAuthByEmail(email);
  // Accounts created with Google have no password; they compare against the dummy hash,
  // so they fail exactly like a wrong password, in the same time.
  const passwordMatches = await verifyPassword(
    password,
    record?.passwordHash ?? (await dummyHash()),
  );

  if (!record?.passwordHash || !passwordMatches) {
    // The same message for "no such email" and "wrong password" so accounts can't be probed.
    throw new UnauthorizedError('Invalid email or password', { code: 'INVALID_CREDENTIALS' });
  }

  // Checked only after the password matched, so it reveals nothing to someone guessing.
  if (!record.emailVerifiedAt) {
    throw new ForbiddenError(
      'Please verify your email: sign up again with this address to get a code.',
      { code: 'EMAIL_NOT_VERIFIED' },
    );
  }

  const { passwordHash: _omit, ...user } = record;
  return user;
}

/** Used by the admin seed: creates the admin, or promotes an existing account. */
export async function ensureAdmin({ email, password, displayName }) {
  const passwordHash = await hashPassword(password);
  return usersService.upsertAdmin({ email, passwordHash, displayName });
}
