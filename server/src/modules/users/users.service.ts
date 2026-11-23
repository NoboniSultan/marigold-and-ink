import type { Pool, PoolClient } from 'pg';
import * as usersRepository from './users.repository.ts';
import { ConflictError, NotFoundError } from '../../errors/index.js';
import { isUniqueViolation } from '../../db/errors.js';
import { toLimitOffset, toPageMeta } from '../../lib/pagination.js';

import type { AuthRecord, Role, UserRecord } from './users.repository.ts';

export type { AuthRecord, Role, UserRecord };

/** Pass `client` to run inside a caller's transaction. */
interface Tx {
  client?: Pool | PoolClient;
}

export function findById(id: number, { client }: Tx = {}): Promise<UserRecord | null> {
  return usersRepository.findById(id, client);
}

export async function getById(id: number, { client }: Tx = {}): Promise<UserRecord> {
  const user = await usersRepository.findById(id, client);
  if (!user) throw new NotFoundError('User not found', { code: 'USER_NOT_FOUND' });
  return user;
}

/** Includes passwordHash and verification state. Only the auth module should call this. */
export function findForAuthByEmail(
  email: string,
  { client, forUpdate = false }: Tx & { forUpdate?: boolean } = {},
): Promise<AuthRecord | null> {
  return usersRepository.findForAuthByEmail(email, client, { forUpdate });
}

/**
 * See users.repository.ts: only for accounts whose email was never verified. Callers lock
 * the row first, so "already verified" here means a bug, and is reported loudly.
 */
export async function claimUnverified(
  id: number,
  { passwordHash, displayName }: { passwordHash: string; displayName: string },
  { client }: Tx = {},
): Promise<UserRecord> {
  const user = await usersRepository.claimUnverified(id, { passwordHash, displayName }, client);
  if (!user) throw new Error(`claimUnverified: user ${id} is missing or already verified`);
  return user;
}

/** Includes passwordHash. Only the auth module should call this (password confirmation). */
export function findForAuthById(
  id: number,
  { client, forUpdate = false }: Tx & { forUpdate?: boolean } = {},
): Promise<AuthRecord | null> {
  return usersRepository.findForAuthById(id, client, { forUpdate });
}

export async function updateDisplayName(
  id: number,
  displayName: string,
  { client }: Tx = {},
): Promise<UserRecord> {
  const user = await usersRepository.updateDisplayName(id, displayName, client);
  if (!user) throw new NotFoundError('User not found', { code: 'USER_NOT_FOUND' });
  return user;
}

/** Only the auth module calls these two (password change, account deletion). */
export function setPasswordHash(id: number, passwordHash: string, { client }: Tx = {}) {
  return usersRepository.setPasswordHash(id, passwordHash, client);
}

export function anonymize(id: number, { client }: Tx = {}) {
  return usersRepository.anonymize(id, client);
}

export async function verifyAndClearPassword(id: number, { client }: Tx = {}): Promise<UserRecord> {
  const user = await usersRepository.verifyAndClearPassword(id, client);
  if (!user) throw new Error(`verifyAndClearPassword: user ${id} is missing or already verified`);
  return user;
}

/**
 * Creates a user. Uniqueness is enforced by the database constraint rather than a
 * "look up, then insert" check, which two simultaneous sign-ups could both pass.
 */
export async function createUser(
  {
    email,
    passwordHash,
    displayName,
    role = 'client',
    emailVerifiedAt = null,
  }: {
    email: string;
    passwordHash: string | null;
    displayName: string;
    role?: Role;
    emailVerifiedAt?: Date | null;
  },
  { client }: Tx = {},
): Promise<UserRecord> {
  try {
    return await usersRepository.insert(
      { email, passwordHash, displayName, role, emailVerifiedAt },
      client,
    );
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_key')) {
      throw new ConflictError('An account with this email already exists', {
        code: 'EMAIL_TAKEN',
      });
    }
    throw err;
  }
}

export function upsertAdmin({
  email,
  passwordHash,
  displayName,
}: {
  email: string;
  passwordHash: string;
  displayName: string;
}): Promise<{ user: UserRecord; created: boolean }> {
  return usersRepository.upsertAdmin({ email, passwordHash, displayName });
}

export async function listUsers(pagination: { page: number; pageSize: number }) {
  const { users, total } = await usersRepository.list(toLimitOffset(pagination));
  return { users, meta: toPageMeta(pagination, total) };
}
