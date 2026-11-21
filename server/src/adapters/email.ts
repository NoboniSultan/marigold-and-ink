/**
 * Sending email. The rest of the app depends only on the EmailSender interface; which
 * implementation it gets is decided once, from config (see createEmailSender), and tests
 * pass a fake that records messages instead of sending them.
 */
import { logger as defaultLogger } from '../lib/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). Plain fetch:
 * one endpoint doesn't justify an SDK dependency.
 */
export function createResendSender({
  apiKey,
  from,
  fetchImpl = globalThis.fetch,
}: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): EmailSender {
  return {
    async send({ to, subject, text, html }) {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text, html }),
        signal: AbortSignal.timeout(10_000),
      }).catch((err: unknown) => {
        throw new EmailDeliveryError('Could not reach the email service', { cause: err });
      });
      if (!response.ok) {
        // The body explains the problem (e.g. an unverified sender domain); it never
        // contains the message itself, so it's safe to log.
        const detail = await response.text().catch(() => '');
        throw new EmailDeliveryError(`Email service answered ${response.status}: ${detail}`);
      }
    },
  };
}

/**
 * Development only (config refuses it in production): writes the email to the server log,
 * so sign-up codes can be read without an email account.
 */
export function createLogSender(log = defaultLogger): EmailSender {
  return {
    async send({ to, subject, text }) {
      log.info({ to, subject, text }, 'email (log transport, development only)');
    },
  };
}

export function createEmailSender(
  emailConfig: { transport: 'resend'; apiKey: string; from: string } | { transport: 'log' } | null,
): EmailSender | null {
  if (!emailConfig) return null;
  return emailConfig.transport === 'resend'
    ? createResendSender({ apiKey: emailConfig.apiKey, from: emailConfig.from })
    : createLogSender();
}
