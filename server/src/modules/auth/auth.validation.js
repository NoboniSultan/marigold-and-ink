import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
// bcrypt only uses the first 72 bytes of a password and silently ignores the rest,
// so longer passwords are rejected rather than quietly weakened.
export const PASSWORD_MAX_BYTES = 72;

// Trimmed and lowercased so 'Ana@X.com ' and 'ana@x.com' are the same account.
// (The citext column would match them anyway; normalizing keeps stored emails tidy.)
const email = z.string().trim().toLowerCase().max(254).pipe(z.email('must be a valid email'));

export const displayName = z.string().trim().min(1).max(100);

export const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES, {
    message: `must be at most ${PASSWORD_MAX_BYTES} bytes`,
  });

/** Step 1 of sign-up: where to send the code. */
export const signupStartBody = z.object({ email });

// Step 2. Unknown fields (e.g. "role": "admin") are stripped by zod, so they never reach
// the service.
export const signupCompleteBody = z.object({
  email,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'must be the 6-digit code from the email'),
  password: newPassword,
  displayName,
});

/**
 * A path on this site: one leading slash, then no backslash, whitespace or control
 * character anywhere. Browsers read `/\evil.example` as `//evil.example` (another site),
 * and drop tabs and newlines from URLs, so `/<tab>/evil.example` would become it too.
 * The client's `safeNextPath` applies the same rule.
 */
export const SAME_SITE_PATH = /^\/(?![/\\])[^\\\s\p{Cc}]*$/u;

/** Where to return after Google sign-in: a same-site path only, never another site. */
export const googleStartQuery = z.object({
  next: z
    .string()
    .regex(SAME_SITE_PATH, 'must be a path on this site')
    .max(500)
    .optional()
    .catch(undefined),
});

// Login doesn't re-apply the password policy (the policy could change after sign-up);
// it only caps the length so nobody can make the server hash megabytes of input.
export const loginBody = z.object({
  email,
  password: z.string().min(1).max(1024),
});
