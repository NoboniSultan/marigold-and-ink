/**
 * A signed-in user managing their own account: what the account page shows, changing the
 * password or email address (ADR 0014), downloading their data, and deleting the account
 * (ADR 0012). Accounts are created elsewhere (auth.signup.service.ts, auth.google.service.ts).
 */
import type { Account } from '@shared/types/user.ts';
import { config } from '../../config/env.js';
import { withTransaction } from '../../db/transaction.ts';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../../errors/index.js';
import { logger } from '../../lib/logger.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { EmailSender } from '../../adapters/email.ts';
import * as usersService from '../users/users.service.ts';
import type { UserRecord } from '../users/users.service.ts';
import * as commissionsService from '../commissions/commissions.service.js';
import * as quotesService from '../quotes/quotes.service.js';
import * as paymentsService from '../payments/payments.service.ts';
import * as filesService from '../files/files.service.ts';
import * as shippingService from '../shipping/shipping.service.ts';
import * as authRepository from './auth.repository.ts';
import {
  CODE_TTL_MINUTES,
  RESEND_COOLDOWN_MS,
  codeFailure,
  consumeCode,
  issueCode,
  sendCodeEmail,
} from './auth.codes.ts';
import { alreadyRegisteredEmail, emailChangeCodeEmail, emailChangedNotice } from './auth.emails.ts';

type Commission = Awaited<ReturnType<typeof commissionsService.closeForDeletedClient>>[number];

/** The account page: the user, plus which sign-in methods they have. */
export async function getAccount(user: UserRecord): Promise<Account> {
  const [record, providers] = await Promise.all([
    usersService.findForAuthById(user.id),
    authRepository.listProvidersForUser(user.id),
  ]);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    hasPassword: Boolean(record?.passwordHash),
    hasGoogle: providers.includes('google'),
  };
}

function passwordIncorrect() {
  return new ForbiddenError('That password is not correct', { code: 'PASSWORD_INCORRECT' });
}

/** Password accounts confirm sensitive changes with the password; Google-only ones can't. */
async function confirmPassword(record: { passwordHash: string | null }, password?: string) {
  if (!record.passwordHash) return;
  if (!password) {
    throw new ValidationError('Enter your password to confirm', { code: 'PASSWORD_REQUIRED' });
  }
  if (!(await verifyPassword(password, record.passwordHash))) throw passwordIncorrect();
}

/**
 * Email change, step 1 (ADR 0014): after the password (if the account has one), email a
 * code to the new address. If that address already belongs to an account, it gets the
 * "you already have an account" note instead, and the answer here is the same, so this
 * can't be used to find out who has an account.
 */
export async function startEmailChange(
  userId: number,
  { newEmail, password }: { newEmail: string; password?: string },
  { emailSender }: { emailSender: EmailSender | null },
): Promise<{ email: string; resendAfterSeconds: number }> {
  if (!emailSender) {
    throw new ServiceUnavailableError("Changing your email isn't available yet.", {
      code: 'EMAIL_CHANGE_UNAVAILABLE',
    });
  }
  const record = await usersService.findForAuthById(userId);
  if (!record) throw new Error(`startEmailChange: user ${userId} not found`);
  if (record.role === 'admin') {
    throw new BusinessRuleError("The admin's email is set in the server settings (ADMIN_EMAIL)", {
      code: 'ADMIN_ACCOUNT',
    });
  }
  if (newEmail.toLowerCase() === record.email.toLowerCase()) {
    throw new BusinessRuleError('That is already your email address', { code: 'EMAIL_UNCHANGED' });
  }
  await confirmPassword(record, password);

  const code = await issueCode({ purpose: 'email_change', email: newEmail, userId });
  const taken = await usersService.findForAuthByEmail(newEmail);
  const message = taken
    ? alreadyRegisteredEmail(newEmail, `${config.publicUrl ?? ''}/login`)
    : emailChangeCodeEmail(newEmail, code, CODE_TTL_MINUTES);
  await sendCodeEmail('email_change', newEmail, emailSender, message);
  return { email: newEmail, resendAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
}

/**
 * Email change, step 2: check the code, move the account to the new (now verified)
 * address, and sign out every session (the controller starts a fresh one for this
 * browser). The old address is then told, so a change the owner didn't make is noticed.
 */
export async function completeEmailChange(
  userId: number,
  { newEmail, code }: { newEmail: string; code: string },
  { emailSender }: { emailSender: EmailSender | null },
): Promise<UserRecord> {
  const result = await withTransaction(async (tx) => {
    const check = await consumeCode(
      { purpose: 'email_change', email: newEmail, code, forUser: userId },
      tx,
    );
    if (!check.ok) return check;
    const record = await usersService.findForAuthById(userId, { client: tx, forUpdate: true });
    if (!record) throw new Error(`completeEmailChange: user ${userId} not found`);
    const user = await usersService.updateEmail(userId, newEmail, { client: tx });
    await authRepository.deleteSessionsForUser(userId, tx);
    return { ok: true as const, user, oldEmail: record.email };
  });
  if (!result.ok) throw codeFailure(result);

  // The change has committed; a failed notice is logged, never reported as a failure.
  try {
    await emailSender?.send(
      emailChangedNotice(result.oldEmail, newEmail, config.publicUrl ?? 'the website'),
    );
  } catch (err) {
    logger.warn({ err, userId }, 'email-changed notice failed to send');
  }
  return result.user;
}

/**
 * "Download my data": everything the site holds about the account, as the client sees it
 * on the site (no internal IDs from Stripe or admin notes): the account, and each of their
 * commissions with its status history, quote, and payments.
 */
export async function exportData(user: UserRecord) {
  const account = await getAccount(user);
  const commissions = [];
  for (let page = 1; ; page += 1) {
    const { commissions: batch, meta } = await commissionsService.listCommissions(user, {
      page,
      pageSize: 100,
      status: undefined,
    });
    for (const commission of batch) {
      if (!commission) continue;
      const [events, payments, shipment] = await Promise.all([
        commissionsService.listEvents(commission.id, user),
        paymentsService.listPayments(commission.id, user),
        shippingService.shipmentForExport(commission.id),
      ]);
      let quote = null;
      try {
        quote = await quotesService.getQuote(commission.id, user);
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err; // no quote sent yet
      }
      commissions.push({ ...commission, events, quote, payments, shipment });
    }
    if (page * 100 >= meta.total) break;
  }
  return { exportedAt: new Date().toISOString(), account, commissions };
}

/**
 * Changes the password after checking the current one, and signs the user out of every
 * session (the controller then starts a fresh one for this browser). Accounts that only
 * use Google have no password to change.
 */
export async function changePassword(
  userId: number,
  { currentPassword, newPassword }: { currentPassword: string; newPassword: string },
): Promise<void> {
  const newHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    const record = await usersService.findForAuthById(userId, { client, forUpdate: true });
    if (!record?.passwordHash) {
      throw new BusinessRuleError('This account signs in with Google and has no password', {
        code: 'NO_PASSWORD',
      });
    }
    if (!(await verifyPassword(currentPassword, record.passwordHash))) throw passwordIncorrect();

    await usersService.setPasswordHash(userId, newHash, { client });
    await authRepository.deleteSessionsForUser(userId, client);
  });
}

/**
 * Deletes (anonymizes) the account, in one transaction:
 *   1. confirm: the password, or for a Google-only account, the email typed again;
 *   2. refuse admins and clients with a paid commission still in progress;
 *   3. cancel unpaid requests and clear commission notes (commissions service);
 *   4. unlink Google, drop any pending codes, remove their reference photos (ADR 0016),
 *      sign out everywhere;
 *   5. anonymize the user row (no email, name, or password left).
 * Returns the commissions it cancelled (for the after-cancel step) and the storage keys of
 * the removed photos (for the caller to delete from storage once this has committed).
 */
export async function deleteAccount(
  userId: number,
  { password, confirmEmail }: { password?: string; confirmEmail?: string },
): Promise<{ canceled: Commission[]; removedFileKeys: string[] }> {
  return withTransaction(async (client) => {
    const record = await usersService.findForAuthById(userId, { client, forUpdate: true });
    // requireAuth already checked the account exists; a concurrent deletion can't get here.
    if (!record) throw new Error(`deleteAccount: user ${userId} not found`);

    if (record.passwordHash) {
      if (!password) {
        throw new ValidationError('Enter your password to delete the account', {
          code: 'PASSWORD_REQUIRED',
        });
      }
      if (!(await verifyPassword(password, record.passwordHash))) throw passwordIncorrect();
    } else if (confirmEmail?.trim().toLowerCase() !== record.email.toLowerCase()) {
      throw new ForbiddenError('Type your email address exactly to confirm', {
        code: 'EMAIL_CONFIRMATION_INCORRECT',
      });
    }

    if (record.role === 'admin') {
      throw new BusinessRuleError('The admin account cannot be deleted from the site', {
        code: 'ADMIN_ACCOUNT',
      });
    }

    const canceled = await commissionsService.closeForDeletedClient(userId, { client });
    await authRepository.deleteIdentitiesForUser(userId, client);
    await authRepository.deleteVerificationsForUser(userId, record.email, client);
    const removedFileKeys = await filesService.takeReferencesForDeletedClient(userId, { client });
    // Name and street off past shipments; the city, state, and ZIP stay for records.
    await shippingService.removeAddressesForDeletedClient(userId, { client });
    await authRepository.deleteSessionsForUser(userId, client);
    await usersService.anonymize(userId, { client });
    return { canceled, removedFileKeys };
  });
}
