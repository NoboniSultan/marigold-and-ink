import { z } from 'zod';
import * as authService from '../../modules/auth/auth.service.js';
import { registerBody } from '../../modules/auth/auth.validation.js';

// Reuses the registration rules, so the admin password meets the same policy as everyone's.
const adminEnv = z.object({
  ADMIN_EMAIL: registerBody.shape.email,
  ADMIN_PASSWORD: registerBody.shape.password,
  ADMIN_DISPLAY_NAME: registerBody.shape.displayName.default('Admin'),
});

/**
 * Creates the admin account from environment variables, or promotes an existing account
 * with that email. Idempotent: safe to run on every deploy, and it never overwrites an
 * existing password. Skips (returns { skipped: true }) when ADMIN_EMAIL isn't set.
 */
export async function seedAdmin(env = process.env) {
  if (!env.ADMIN_EMAIL) return { skipped: true, reason: 'ADMIN_EMAIL is not set' };

  const parsed = adminEnv.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid admin seed configuration:\n${z.prettifyError(parsed.error)}`);
  }

  const { user, created } = await authService.ensureAdmin({
    email: parsed.data.ADMIN_EMAIL,
    password: parsed.data.ADMIN_PASSWORD,
    displayName: parsed.data.ADMIN_DISPLAY_NAME,
  });
  return { skipped: false, created, userId: user.id };
}
