/**
 * Forgot password, in two steps (ADR 0014), built on the same emailed codes as sign-up:
 *
 * 1. startPasswordReset(email): emails a 6-digit code, but only to an address with a
 *    verified client account. The answer, and the one-a-minute cooldown, are the same for
 *    every address, so the form can't be used to find out who has an account.
 * 2. completePasswordReset(email, code, newPassword): checks the code, sets the password,
 *    and signs the account out everywhere; the controller then signs this browser in.
 *
 * The admin account is left out: its password comes from the server settings
 * (ADMIN_PASSWORD), which the seed applies on every deploy.
 */
import { withTransaction } from '../../db/transaction.ts';
import { ServiceUnavailableError } from '../../errors/index.js';
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
import { passwordResetCodeEmail } from './auth.emails.ts';

/** Accounts a reset can apply to: verified, and not the admin. */
function canReset(account: { emailVerifiedAt: Date | null; role: string } | null): boolean {
  return Boolean(account?.emailVerifiedAt) && account?.role !== 'admin';
}

export async function startPasswordReset(
  { email }: { email: string },
  { emailSender }: { emailSender: EmailSender | null },
): Promise<{ resendAfterSeconds: number }> {
  if (!emailSender) {
    throw new ServiceUnavailableError(
      "Password reset isn't available yet. Please try again later.",
      {
        code: 'PASSWORD_RESET_UNAVAILABLE',
      },
    );
  }
  // Stored for every address (sent only to a real account), so the cooldown and the answer
  // don't reveal which addresses have accounts.
  const code = await issueCode({ purpose: 'password_reset', email });
  if (canReset(await usersService.findForAuthByEmail(email))) {
    await sendCodeEmail(
      'password_reset',
      email,
      emailSender,
      passwordResetCodeEmail(email, code, CODE_TTL_MINUTES),
    );
  }
  return { resendAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
}

export async function completePasswordReset({
  email,
  code,
  newPassword,
}: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<UserRecord> {
  // Hash first: bcrypt is deliberately slow, and shouldn't hold the row lock below.
  const passwordHash = await hashPassword(newPassword);

  const result = await withTransaction(
    async (tx): Promise<{ ok: true; user: UserRecord } | Exclude<CodeCheck, { ok: true }>> => {
      const check = await consumeCode({ purpose: 'password_reset', email, code }, tx);
      if (!check.ok) return check;

      const account = await usersService.findForAuthByEmail(email, { client: tx, forUpdate: true });
      // Deleted or changed since the code was sent: the code no longer applies.
      if (!account || !canReset(account)) return { ok: false, reason: 'expired' };

      await usersService.setPasswordHash(account.id, passwordHash, { client: tx });
      // Whoever knew the old password may still be signed in somewhere.
      await authRepository.deleteSessionsForUser(account.id, tx);
      const { passwordHash: _old, ...user } = account;
      return { ok: true, user };
    },
  );
  if (!result.ok) throw codeFailure(result);
  return result.user;
}
