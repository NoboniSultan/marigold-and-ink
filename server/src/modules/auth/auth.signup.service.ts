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
import {
  BusinessRuleError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
} from '../../errors/index.js';
import { hashPassword } from '../../lib/password.js';
import { generateCode, hashCode, hashesMatch } from '../../lib/verificationCode.ts';
import { logger } from '../../lib/logger.js';
import type { EmailSender } from '../../adapters/email.ts';
import * as usersService from '../users/users.service.ts';
import type { UserRecord } from '../users/users.service.ts';
import * as authRepository from './auth.repository.ts';
import { alreadyRegisteredEmail, signupCodeEmail } from './auth.emails.ts';

export const CODE_TTL_MINUTES = 15;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;

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
  const code = generateCode();
  const saved = await authRepository.saveVerification({
    email,
    codeHash: hashCode(email, code, config.authSecret),
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    cooldownMs: RESEND_COOLDOWN_MS,
  });
  if (!saved) {
    const seconds = await authRepository.secondsUntilResend(email, RESEND_COOLDOWN_MS);
    throw new RateLimitError(`Please wait ${seconds} seconds before asking for another code`, {
      code: 'CODE_RESEND_TOO_SOON',
      details: { retryAfterSeconds: seconds },
    });
  }

  const existing = await usersService.findForAuthByEmail(email);
  const message = existing?.emailVerifiedAt
    ? alreadyRegisteredEmail(email, `${config.publicUrl ?? ''}/login`)
    : signupCodeEmail(email, code, CODE_TTL_MINUTES);

  try {
    await emailSender.send(message);
  } catch (err) {
    // Forget the code, so the visitor can try again at once instead of waiting out the
    // cooldown for an email that never arrived.
    await authRepository.deleteVerification(email);
    logger.error({ err }, 'sign-up email failed to send');
    throw new ServiceUnavailableError("We couldn't send the email. Please try again.", {
      code: 'EMAIL_SEND_FAILED',
    });
  }
  return { resendAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
}

type CheckResult =
  | { ok: true; user: UserRecord }
  | { ok: false; reason: 'expired' }
  | { ok: false; reason: 'incorrect'; remainingAttempts: number }
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
    const pending = await authRepository.findVerification(email, tx, { forUpdate: true });
    if (!pending || pending.expiresAt <= new Date() || pending.attempts >= MAX_ATTEMPTS) {
      return { ok: false, reason: 'expired' };
    }
    if (!hashesMatch(hashCode(email, code, config.authSecret), pending.codeHash)) {
      await authRepository.recordFailedAttempt(email, tx);
      return {
        ok: false,
        reason: 'incorrect',
        remainingAttempts: MAX_ATTEMPTS - pending.attempts - 1,
      };
    }

    // The code is used up whatever happens next.
    await authRepository.deleteVerification(email, tx);

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
  if (result.reason === 'incorrect' && result.remainingAttempts > 0) {
    throw new BusinessRuleError(
      `That code isn't right. ${result.remainingAttempts} ${result.remainingAttempts === 1 ? 'try' : 'tries'} left.`,
      { code: 'CODE_INCORRECT', details: { remainingAttempts: result.remainingAttempts } },
    );
  }
  throw new BusinessRuleError('This code has expired or been used up. Please send a new one.', {
    code: 'CODE_EXPIRED',
  });
}
