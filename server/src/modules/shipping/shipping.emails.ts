/**
 * The shipping emails (milestone 11b). The wording to clients is the owner's: until it's
 * written, it reads PLACEHOLDER, and an email that still has a placeholder is never sent in
 * production (see shipping.tracking.service.ts). The facts below the wording (tracking
 * number and links) are filled in by the code.
 */
import type { EmailMessage } from '../../adapters/email.ts';

export const SHIPPING_EMAIL_COPY = {
  shipped: {
    subject: 'PLACEHOLDER: subject of the "your commission has shipped" email',
    lines: ['PLACEHOLDER: the opening of the "your commission has shipped" email.'],
  },
  delivered: {
    subject: 'PLACEHOLDER: subject of the "your commission was delivered" email',
    lines: ['PLACEHOLDER: the opening of the "your commission was delivered" email.'],
  },
} as const;

const PLACEHOLDER = 'PLACEHOLDER:';

/** True while the owner's wording hasn't been written yet. */
export function hasPlaceholder(message: EmailMessage): boolean {
  return message.subject.includes(PLACEHOLDER) || message.text.includes(PLACEHOLDER);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function build(to: string, subject: string, lines: string[]): EmailMessage {
  return {
    to,
    subject,
    text: lines.join('\n\n'),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
  };
}

export interface PackageFacts {
  carrier: string;
  serviceName: string;
  trackingNumber: string;
  trackingUrl: string | null;
  /** The client's commission page. */
  pageUrl: string;
}

function factLines(facts: PackageFacts | null, pageUrl: string): string[] {
  return [
    ...(facts
      ? [`Tracking number: ${facts.trackingNumber} (${facts.carrier} ${facts.serviceName})`]
      : []),
    ...(facts?.trackingUrl ? [`Track the package: ${facts.trackingUrl}`] : []),
    `Your commission: ${pageUrl}`,
  ];
}

/** To the client when the carrier has the package (or the owner marks it shipped). */
export function shippedEmail(to: string, facts: PackageFacts | null, pageUrl: string) {
  const copy = SHIPPING_EMAIL_COPY.shipped;
  return build(to, copy.subject, [...copy.lines, ...factLines(facts, pageUrl)]);
}

/** To the client when the package was delivered (or the owner marks it delivered). */
export function deliveredEmail(to: string, facts: PackageFacts | null, pageUrl: string) {
  const copy = SHIPPING_EMAIL_COPY.delivered;
  return build(to, copy.subject, [...copy.lines, ...factLines(facts, pageUrl)]);
}

/** To the owner: the carrier reports the package is coming back or can't be delivered. */
export function deliveryProblemEmail(
  to: string,
  problem: {
    commissionId: number;
    trackingNumber: string;
    status: 'returned' | 'failure';
    details: string | null;
    adminUrl: string;
  },
) {
  const what = problem.status === 'returned' ? 'is being returned' : "couldn't be delivered";
  return build(to, `Delivery problem: commission #${problem.commissionId}`, [
    `The carrier reports that the package for commission #${problem.commissionId} ${what}.`,
    ...(problem.details ? [`Carrier's note: ${problem.details}`] : []),
    `Tracking number: ${problem.trackingNumber}`,
    `Commission: ${problem.adminUrl}`,
  ]);
}
