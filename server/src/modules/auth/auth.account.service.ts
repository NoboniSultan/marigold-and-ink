/**
 * A signed-in user managing their own account: what the account page shows, changing the
 * password, and deleting the account (ADR 0012). Accounts are created elsewhere
 * (auth.signup.service.ts, auth.google.service.ts).
 */
import type { Account } from '@shared/types/user.ts';
import { withTransaction } from '../../db/transaction.ts';
import { BusinessRuleError, ForbiddenError, ValidationError } from '../../errors/index.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import * as usersService from '../users/users.service.ts';
import type { UserRecord } from '../users/users.service.ts';
import * as commissionsService from '../commissions/commissions.service.js';
import * as authRepository from './auth.repository.ts';

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
 *   4. unlink Google, drop any pending sign-up code, sign out everywhere;
 *   5. anonymize the user row (no email, name, or password left).
 * Returns the commissions it cancelled, for the after-cancel step.
 */
export async function deleteAccount(
  userId: number,
  { password, confirmEmail }: { password?: string; confirmEmail?: string },
): Promise<Commission[]> {
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
    await authRepository.deleteVerification(record.email, client);
    await authRepository.deleteSessionsForUser(userId, client);
    await usersService.anonymize(userId, { client });
    return canceled;
  });
}
