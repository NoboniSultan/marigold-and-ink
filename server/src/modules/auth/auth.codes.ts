/**
 * Emailed 6-digit codes, shared by sign-up, password reset, and email change (ADR 0010,
 * ADR 0014). One set of rules for all three:
 * - a code lasts 15 minutes and allows 5 wrong tries;
 * - a new code for the same address and purpose replaces the old one, at most once a
 *   minute;
 * - only a keyed hash is stored (HMAC with AUTH_SECRET), never the code;
 * - expired codes are deleted whenever a new one is issued.
 */
import type { PoolClient } from 'pg';
import { config } from '../../config/env.js';
import { BusinessRuleError, RateLimitError, ServiceUnavailableError } from '../../errors/index.js';
import { logger } from '../../lib/logger.js';
import { generateCode, hashCode, hashesMatch } from '../../lib/verificationCode.ts';
import type { EmailMessage, EmailSender } from '../../adapters/email.ts';
import * as authRepository from './auth.repository.ts';
import type { CodePurpose } from './auth.repository.ts';

export const CODE_TTL_MINUTES = 15;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;

/**
 * The hash binds the code to its purpose as well as its address, so a sign-up code could
 * never be replayed as a password-reset code even if the rows were mixed up.
 */
function hashFor(purpose: CodePurpose, email: string, code: string): string {
  return hashCode(purpose === 'signup' ? email : `${purpose}:${email}`, code, config.authSecret);
}

/**
 * Stores a fresh code for `email` and returns it (to be emailed), or throws 429 if one was
 * sent in the last minute. The same answer whatever account the address has.
 */
export async function issueCode({
  purpose,
  email,
  userId = null,
}: {
  purpose: CodePurpose;
  email: string;
  userId?: number | null;
}): Promise<string> {
  await authRepository.deleteExpiredVerifications();
  const code = generateCode();
  const saved = await authRepository.saveVerification({
    purpose,
    email,
    userId,
    codeHash: hashFor(purpose, email, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    cooldownMs: RESEND_COOLDOWN_MS,
  });
  if (!saved) {
    const seconds = await authRepository.secondsUntilResend(purpose, email, RESEND_COOLDOWN_MS);
    throw new RateLimitError(`Please wait ${seconds} seconds before asking for another code`, {
      code: 'CODE_RESEND_TOO_SOON',
      details: { retryAfterSeconds: seconds },
    });
  }
  return code;
}

/**
 * Sends `message`. If sending fails, the code is forgotten so the visitor can try again at
 * once instead of waiting out the cooldown for an email that never arrived.
 */
export async function sendCodeEmail(
  purpose: CodePurpose,
  email: string,
  emailSender: EmailSender,
  message: EmailMessage,
): Promise<void> {
  try {
    await emailSender.send(message);
  } catch (err) {
    await authRepository.deleteVerification(purpose, email);
    logger.error({ err, purpose }, 'code email failed to send');
    throw new ServiceUnavailableError("We couldn't send the email. Please try again.", {
      code: 'EMAIL_SEND_FAILED',
    });
  }
}

export type CodeCheck =
  | { ok: true; userId: number | null }
  | { ok: false; reason: 'expired' }
  | { ok: false; reason: 'incorrect'; remainingAttempts: number };

/**
 * Checks a code inside the caller's transaction, locking its row. A correct code is used
 * up (deleted). Failures are returned, not thrown, so the caller can commit a wrong
 * guess's attempt count before throwing (a thrown error would roll the count back).
 */
export async function consumeCode(
  {
    purpose,
    email,
    code,
    forUser,
  }: { purpose: CodePurpose; email: string; code: string; forUser?: number },
  tx: PoolClient,
): Promise<CodeCheck> {
  const pending = await authRepository.findVerification(purpose, email, tx, { forUpdate: true });
  if (
    !pending ||
    pending.expiresAt <= new Date() ||
    pending.attempts >= MAX_ATTEMPTS ||
    // An email-change code only works for the account that asked for it.
    (forUser !== undefined && pending.userId !== forUser)
  ) {
    return { ok: false, reason: 'expired' };
  }
  if (!hashesMatch(hashFor(purpose, email, code), pending.codeHash)) {
    await authRepository.recordFailedAttempt(purpose, email, tx);
    return {
      ok: false,
      reason: 'incorrect',
      remainingAttempts: MAX_ATTEMPTS - pending.attempts - 1,
    };
  }
  await authRepository.deleteVerification(purpose, email, tx);
  return { ok: true, userId: pending.userId };
}

/** The error for a failed check: a wrong code with tries left, or a used-up one. */
export function codeFailure(check: Exclude<CodeCheck, { ok: true }>) {
  if (check.reason === 'incorrect' && check.remainingAttempts > 0) {
    return new BusinessRuleError(
      `That code isn't right. ${check.remainingAttempts} ${check.remainingAttempts === 1 ? 'try' : 'tries'} left.`,
      { code: 'CODE_INCORRECT', details: { remainingAttempts: check.remainingAttempts } },
    );
  }
  return new BusinessRuleError('This code has expired or been used up. Please send a new one.', {
    code: 'CODE_EXPIRED',
  });
}
