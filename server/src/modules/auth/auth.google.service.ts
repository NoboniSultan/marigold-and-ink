/**
 * Signing in with Google, once the adapter has verified the ID token.
 *
 * Who the visitor becomes:
 * 1. A user already linked to this Google account (matched on Google's permanent `sub`).
 * 2. Otherwise, the user with the same email (Google says it's verified), and the Google
 *    account is linked to them. If that account's email was never verified, its password
 *    may have been set by someone else, so the password is removed and every other session
 *    is signed out (ADR 0010).
 * 3. Otherwise, a new client account, verified, with no password.
 *
 * Google never grants admin: admin accounts can't sign in with Google at all; the admin
 * uses their password (rate-limited) instead.
 */
import { withTransaction } from '../../db/transaction.ts';
import { isUniqueViolation } from '../../db/errors.js';
import type { GoogleChecks, GoogleAuth, GoogleProfile } from '../../adapters/googleOidc.ts';
import * as usersService from '../users/users.service.ts';
import * as authRepository from './auth.repository.ts';

/** Reasons a Google sign-in fails; each becomes ?error=<reason> on the login page. */
export type GoogleFailure =
  | 'google_unavailable'
  | 'google_cancelled'
  | 'google_failed'
  | 'google_unverified_email'
  | 'google_admin'
  | 'google_account_conflict';

export class GoogleSignInError extends Error {
  readonly reason: GoogleFailure;

  constructor(reason: GoogleFailure, options?: ErrorOptions) {
    super(reason, options);
    this.name = 'GoogleSignInError';
    this.reason = reason;
  }
}

interface AppUser {
  id: number;
  role: string;
  emailVerifiedAt: Date | null;
}

function displayNameFor(profile: GoogleProfile, email: string): string {
  const name = profile.name?.trim() || email.split('@')[0] || 'Friend';
  return name.slice(0, 100);
}

async function signInWith(profile: GoogleProfile): Promise<AppUser> {
  if (!profile.email || !profile.emailVerified) {
    throw new GoogleSignInError('google_unverified_email');
  }
  const email = profile.email.toLowerCase();

  return withTransaction(async (tx) => {
    const identity = await authRepository.findIdentity('google', profile.sub, tx);
    if (identity) {
      const user = (await usersService.findById(identity.userId, { client: tx })) as AppUser;
      if (user.role === 'admin') throw new GoogleSignInError('google_admin');
      return user;
    }

    const existing = (await usersService.findForAuthByEmail(email, {
      client: tx,
      forUpdate: true,
    })) as AppUser | null;

    if (existing) {
      if (existing.role === 'admin') throw new GoogleSignInError('google_admin');
      try {
        await authRepository.insertIdentity(
          { userId: existing.id, provider: 'google', providerUserId: profile.sub, email },
          tx,
        );
      } catch (err) {
        // This user is already linked to a different Google account.
        if (isUniqueViolation(err, 'auth_identities_user_provider_key')) {
          throw new GoogleSignInError('google_account_conflict', { cause: err });
        }
        throw err;
      }
      if (existing.emailVerifiedAt) return existing;
      await authRepository.deleteSessionsForUser(existing.id, tx);
      return (await usersService.verifyAndClearPassword(existing.id, { client: tx })) as AppUser;
    }

    const user = (await usersService.createUser(
      {
        email,
        passwordHash: null,
        displayName: displayNameFor(profile, email),
        role: 'client',
        emailVerifiedAt: new Date(),
      },
      { client: tx },
    )) as AppUser;
    await authRepository.insertIdentity(
      { userId: user.id, provider: 'google', providerUserId: profile.sub, email },
      tx,
    );
    return user;
  });
}

export function startGoogleSignIn(google: GoogleAuth | null) {
  if (!google) throw new GoogleSignInError('google_unavailable');
  return google.start().catch((err: unknown) => {
    throw new GoogleSignInError('google_failed', { cause: err });
  });
}

export async function finishGoogleSignIn(
  google: GoogleAuth | null,
  callbackUrl: URL,
  checks: GoogleChecks | undefined,
): Promise<AppUser> {
  if (!google) throw new GoogleSignInError('google_unavailable');
  // The visitor pressed "Cancel" on Google's page.
  if (callbackUrl.searchParams.get('error') === 'access_denied') {
    throw new GoogleSignInError('google_cancelled');
  }
  // No pending sign-in in this browser's session: the callback wasn't started here.
  if (!checks) throw new GoogleSignInError('google_failed');

  let profile: GoogleProfile;
  try {
    profile = await google.finish(callbackUrl, checks);
  } catch (err) {
    // A state or nonce mismatch, a tampered or expired token, or Google being unreachable.
    throw new GoogleSignInError('google_failed', { cause: err });
  }
  return signInWith(profile);
}
