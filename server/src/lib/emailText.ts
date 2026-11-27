/**
 * Helpers for the site's transactional emails: plain lines turned into a text and an HTML
 * body, and the check that keeps unwritten (PLACEHOLDER) wording from reaching a real person.
 */
import type { EmailMessage } from '../adapters/email.ts';

const PLACEHOLDER = 'PLACEHOLDER:';

/** True while the owner's wording hasn't been written yet. */
export function hasPlaceholder(message: EmailMessage): boolean {
  return message.subject.includes(PLACEHOLDER) || message.text.includes(PLACEHOLDER);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** One paragraph per line, in both the text and the HTML body. */
export function buildEmail(to: string, subject: string, lines: string[]): EmailMessage {
  return {
    to,
    subject,
    text: lines.join('\n\n'),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
  };
}
