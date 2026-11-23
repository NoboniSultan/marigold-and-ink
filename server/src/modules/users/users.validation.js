import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { displayName, newPassword } from '../auth/auth.validation.js';

export const userIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const listUsersQuery = paginationQuery;

export const updateProfileBody = z.object({ displayName });

export const changePasswordBody = z.object({
  // The current password is only compared, never stored, so it isn't held to the new rules.
  currentPassword: z.string().min(1).max(200),
  newPassword,
});

// One of the two, depending on the account (the service decides which it needs).
export const deleteAccountBody = z
  .object({
    password: z.string().min(1).max(200).optional(),
    confirmEmail: z.string().trim().min(1).max(254).optional(),
  })
  .refine((body) => body.password !== undefined || body.confirmEmail !== undefined, {
    message: 'send your password, or your email address for a Google-only account',
  });
