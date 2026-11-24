/**
 * The account emails' wording. Plain and transactional on purpose; the owner can edit the
 * text here (keep the code and the expiry in the first lines, where previews show them).
 */
import type { EmailMessage } from '../../adapters/email.ts';

const BRAND = 'Marigold & Ink';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function paragraphs(lines: string[]): string {
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n');
}

export function signupCodeEmail(to: string, code: string, ttlMinutes: number): EmailMessage {
  const lines = [
    `Your ${BRAND} sign-up code is ${code}.`,
    `It works for ${ttlMinutes} minutes. Enter it on the sign-up page to create your account.`,
    "If you didn't try to create an account, you can ignore this email.",
  ];
  return {
    to,
    subject: `${code} is your ${BRAND} sign-up code`,
    text: lines.join('\n\n'),
    html: paragraphs(lines).replace(code, `<strong style="font-size:1.4em">${code}</strong>`),
  };
}

/**
 * Sent instead of a code when the email already has an account. The sign-up form answers
 * the same way either way, so the form can't be used to discover who has an account.
 */
export function alreadyRegisteredEmail(to: string, loginUrl: string): EmailMessage {
  const lines = [
    `Someone (hopefully you) tried to create a ${BRAND} account with this email address.`,
    `You already have an account, so no new one was made. You can log in at ${loginUrl}.`,
    "If it wasn't you, you can ignore this email; nothing has changed.",
  ];
  return {
    to,
    subject: `You already have a ${BRAND} account`,
    text: lines.join('\n\n'),
    html: paragraphs(lines),
  };
}

/** Password reset (ADR 0014): only sent to an address with a verified, non-admin account. */
export function passwordResetCodeEmail(to: string, code: string, ttlMinutes: number): EmailMessage {
  const lines = [
    `Your ${BRAND} password reset code is ${code}.`,
    `It works for ${ttlMinutes} minutes. Enter it on the reset page, with your new password.`,
    "If you didn't ask to reset your password, you can ignore this email; your password hasn't changed.",
  ];
  return {
    to,
    subject: `${code} is your ${BRAND} password reset code`,
    text: lines.join('\n\n'),
    html: paragraphs(lines).replace(code, `<strong style="font-size:1.4em">${code}</strong>`),
  };
}

/** Email change: the code goes to the new address, proving the account holder can read it. */
export function emailChangeCodeEmail(to: string, code: string, ttlMinutes: number): EmailMessage {
  const lines = [
    `Your ${BRAND} code to confirm this email address is ${code}.`,
    `It works for ${ttlMinutes} minutes. Enter it on your account page to move your account to this address.`,
    "If you didn't ask for this, you can ignore this email; nothing will change.",
  ];
  return {
    to,
    subject: `${code} is your ${BRAND} email confirmation code`,
    text: lines.join('\n\n'),
    html: paragraphs(lines).replace(code, `<strong style="font-size:1.4em">${code}</strong>`),
  };
}

/**
 * Sent to the old address once an account has moved to a new one, so a change the owner
 * didn't make can't go unnoticed.
 */
export function emailChangedNotice(to: string, newEmail: string, siteUrl: string): EmailMessage {
  const lines = [
    `The email address on your ${BRAND} account was changed to ${newEmail}.`,
    'From now on, sign-in and emails use that address.',
    `If you didn't make this change, please contact ${BRAND} through ${siteUrl} right away.`,
  ];
  return {
    to,
    subject: `Your ${BRAND} email address was changed`,
    text: lines.join('\n\n'),
    html: paragraphs(lines),
  };
}
