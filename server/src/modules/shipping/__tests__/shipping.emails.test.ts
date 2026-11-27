import { describe, it, expect } from 'vitest';
import {
  SHIPPING_EMAIL_COPY,
  deliveredEmail,
  deliveryProblemEmail,
  hasPlaceholder,
  shippedEmail,
} from '../shipping.emails.ts';

const FACTS = {
  carrier: 'USPS',
  serviceName: 'Ground Advantage',
  trackingNumber: '9400111',
  trackingUrl: 'https://tools.usps.com/x?a=1&b=2',
  pageUrl: 'https://site.example/commissions/7',
};

describe('shipping emails', () => {
  it("add the package's facts below the owner's wording", () => {
    const message = shippedEmail('ana@example.com', FACTS, FACTS.pageUrl);
    expect(message.to).toBe('ana@example.com');
    expect(message.subject).toBe(SHIPPING_EMAIL_COPY.shipped.subject);
    expect(message.text.split('\n\n')).toEqual([
      ...SHIPPING_EMAIL_COPY.shipped.lines,
      'Tracking number: 9400111 (USPS Ground Advantage)',
      'Track the package: https://tools.usps.com/x?a=1&b=2',
      'Your commission: https://site.example/commissions/7',
    ]);
    expect(message.html).toContain('a=1&#38;b=2'); // escaped in HTML
  });

  it('leave out what a hand-marked change has no label for', () => {
    const message = deliveredEmail('ana@example.com', null, FACTS.pageUrl);
    expect(message.subject).toBe(SHIPPING_EMAIL_COPY.delivered.subject);
    expect(message.text).not.toContain('Tracking');
    expect(deliveredEmail('a@b.c', { ...FACTS, trackingUrl: null }, 'u').text).not.toContain(
      'Track the package',
    );
  });

  it('tell the owner what went wrong', () => {
    const failed = deliveryProblemEmail('owner@example.com', {
      commissionId: 7,
      trackingNumber: '9400111',
      status: 'failure',
      details: null,
      adminUrl: 'https://site.example/admin/commissions/7',
    });
    expect(failed.subject).toBe('Delivery problem: commission #7');
    expect(failed.text).toContain("couldn't be delivered");
    expect(failed.text).not.toContain("Carrier's note");
    expect(hasPlaceholder(failed)).toBe(false);
  });

  it('are held back while the client wording is still a placeholder', () => {
    // Until the owner writes it, these are never sent in production.
    expect(hasPlaceholder(shippedEmail('a@b.c', FACTS, 'u'))).toBe(true);
    expect(hasPlaceholder(deliveredEmail('a@b.c', FACTS, 'u'))).toBe(true);
    expect(hasPlaceholder({ to: 'a', subject: 'Hi', text: 'PLACEHOLDER: x', html: '' })).toBe(true);
  });
});
