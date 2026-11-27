/**
 * The shipping emails (milestone 11b). The wording to clients is the owner's (2026-11-26);
 * edit it here. If it's ever replaced by a PLACEHOLDER again, that email isn't sent in
 * production (see shipping.tracking.service.ts). The facts below the wording (tracking
 * number and links) are filled in by the code.
 */
import type { EmailMessage } from '../../adapters/email.ts';

export const SHIPPING_EMAIL_COPY = {
  shipped: {
    subject: 'Your Marigold & Ink order is on its way!',
    lines: ['Your order has been packed with care and is officially on its way to you!'],
    /** Added to the first line only when the email has a tracking link to point to. */
    withTrackingLink: 'You can follow its journey using the tracking link below.',
  },
  delivered: {
    subject: 'Your Marigold & Ink order has arrived!',
    lines: [
      'Your package has been marked as delivered! I hope it finds a special place in your home and brings you a little joy.',
    ],
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

/**
 * To the client when the carrier has the package (or the owner marks it shipped). Marked by
 * hand without a label, there's no tracking link, so the sentence about it is left out.
 */
export function shippedEmail(to: string, facts: PackageFacts | null, pageUrl: string) {
  const copy = SHIPPING_EMAIL_COPY.shipped;
  const [first, ...rest] = copy.lines;
  const opening = facts?.trackingUrl ? `${first} ${copy.withTrackingLink}` : first;
  return build(to, copy.subject, [opening, ...rest, ...factLines(facts, pageUrl)]);
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
