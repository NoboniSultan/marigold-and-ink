/**
 * Email sign-up in two steps, so an account only exists once its owner has proven the email:
 *
 * 1. startSignup(email): emails a 6-digit code (or, if the email already has a verified
 *    account, a "you already have an account" note). The response is identical either way,
 *    so the form can't be used to find out who has an account.
 * 2. completeSignup(email, code, name, password): checks the code and creates the account,
 *    already verified, and the controller logs the visitor in.
 *
 * Because nobody can create an account for an email they can't read, "account
 * pre-hijacking" (registering someone else's email first) doesn't work. An account left
 * unverified from before this flow can be claimed by its email's owner the same way.
 */
import { config } from '../../config/env.js';
import { withTransaction } from '../../db/transaction.ts';
import { ConflictError, ServiceUnavailableError } from '../../errors/index.js';
import { hashPassword } from '../../lib/password.js';
import type { EmailSender } from '../../adapters/email.ts';
import * as usersService from '../users/users.service.ts';
import type { UserRecord } from '../users/users.service.ts';
import * as authRepository from './auth.repository.ts';
import {
  CODE_TTL_MINUTES,
  RESEND_COOLDOWN_MS,
  codeFailure,
  consumeCode,
  issueCode,
  sendCodeEmail,
  type CodeCheck,
} from './auth.codes.ts';
import { alreadyRegisteredEmail, signupCodeEmail } from './auth.emails.ts';

export { CODE_TTL_MINUTES, MAX_ATTEMPTS, RESEND_COOLDOWN_MS } from './auth.codes.ts';

const unavailable = () =>
  new ServiceUnavailableError("Sign-up by email isn't available yet. Please try again later.", {
    code: 'EMAIL_SIGNUP_UNAVAILABLE',
  });

export async function startSignup(
  { email }: { email: string },
  { emailSender }: { emailSender: EmailSender | null },
): Promise<{ resendAfterSeconds: number }> {
  if (!emailSender) throw unavailable();

  // A code is stored even for an existing account (it's never sent), so the cooldown and
  // the response are the same for every address.
  const code = await issueCode({ purpose: 'signup', email });

  const existing = await usersService.findForAuthByEmail(email);
  const message = existing?.emailVerifiedAt
    ? alreadyRegisteredEmail(email, `${config.publicUrl ?? ''}/login`)
    : signupCodeEmail(email, code, CODE_TTL_MINUTES);

  await sendCodeEmail('signup', email, emailSender, message);
  return { resendAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
}

type CheckResult =
  | { ok: true; user: UserRecord }
  | Exclude<CodeCheck, { ok: true }>
  | { ok: false; reason: 'taken' };

export async function completeSignup({
  email,
  code,
  password,
  displayName,
}: {
  email: string;
  code: string;
  password: string;
  displayName: string;
}): Promise<UserRecord> {
  // Hash first: bcrypt is deliberately slow, and shouldn't hold the row lock below.
  const passwordHash = await hashPassword(password);

  // The transaction returns failures instead of throwing them, so a wrong guess still
  // commits its attempt count (a thrown error would roll the count back).
  const result = await withTransaction(async (tx): Promise<CheckResult> => {
    // A correct code is used up whatever happens next.
    const check = await consumeCode({ purpose: 'signup', email, code }, tx);
    if (!check.ok) return check;

    const existing = await usersService.findForAuthByEmail(email, { client: tx, forUpdate: true });
    if (existing?.emailVerifiedAt) return { ok: false, reason: 'taken' };
    if (existing) {
      // Whoever set the old password may still be logged in; the email's proven owner is
      // taking the account over, so every earlier session ends (as with Google; ADR 0010).
      await authRepository.deleteSessionsForUser(existing.id, tx);
      const user = await usersService.claimUnverified(
        existing.id,
        { passwordHash, displayName },
        { client: tx },
      );
      return { ok: true, user };
    }
    const user = await usersService.createUser(
      { email, passwordHash, displayName, role: 'client', emailVerifiedAt: new Date() },
      { client: tx },
    );
    return { ok: true, user };
  });

  if (result.ok) return result.user;
  if (result.reason === 'taken') {
    throw new ConflictError('An account with this email already exists. Please log in.', {
      code: 'EMAIL_TAKEN',
    });
  }
  throw codeFailure(result);
}
