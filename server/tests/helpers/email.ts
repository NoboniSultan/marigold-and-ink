/**
 * A fake email sender for tests: records messages instead of sending them, and can be told
 * to fail once (a provider outage). `lastCode()` reads the 6-digit code from the newest one.
 */
import type { EmailMessage, EmailSender } from '../../src/adapters/email.ts';

export function fakeEmail() {
  const sent: EmailMessage[] = [];
  let failNext = false;
  const sender: EmailSender = {
    async send(message) {
      if (failNext) {
        failNext = false;
        throw new Error('provider down');
      }
      sent.push(message);
    },
  };
  return {
    sender,
    sent,
    failOnce: () => {
      failNext = true;
    },
    lastCode: () => sent.at(-1)?.text.match(/\b(\d{6})\b/)?.[1],
  };
}
