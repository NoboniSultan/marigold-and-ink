/**
 * The shipping module's rules (milestone 11, ADR 0017): which commissions ship, when the
 * address and package can change, which services are offered, and what shipping costs.
 * Pure, so they're unit-tested on their own. Owner decisions (2026-11-25): United States
 * only, USPS only to start, mixed media is delivered as files and never shipped.
 */
import { sumCents } from '../../lib/money.js';

/** Only physical work ships. Digital and mixed-media work is delivered as files. */
export function ships(fulfillmentType: string): boolean {
  return fulfillmentType === 'physical';
}

/** The address and package can be set from the deposit until the final payment. */
export const ADDRESS_STATUSES = [
  'deposit_paid',
  'in_progress',
  'revision',
  'awaiting_final_payment',
] as const;

export function addressOpen(status: string): boolean {
  return (ADDRESS_STATUSES as readonly string[]).includes(status);
}

/** Prices are fetched and an option chosen while the final payment is due. */
export function choosingOpen(status: string): boolean {
  return status === 'awaiting_final_payment';
}

/**
 * The USPS services offered, cheapest to fastest; all are tracked. Media Mail is left out:
 * artwork doesn't qualify for it.
 */
export const OFFERED_SERVICES = [
  'usps_ground_advantage',
  'usps_priority',
  'usps_priority_express',
] as const;

export function offered<T extends { serviceToken: string; amountCents: number }>(rates: T[]): T[] {
  return rates
    .filter((rate) => (OFFERED_SERVICES as readonly string[]).includes(rate.serviceToken))
    .sort((a, b) => a.amountCents - b.amountCents);
}

/** What the final payment adds for shipping: postage plus the owner's packaging fee. */
export function shippingCents(postageCents: number, packagingFeeCents: number): number {
  return sumCents([postageCents, packagingFeeCents]);
}

/** US states, DC, territories, and military post offices (USPS delivers to all). */
export const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
  'PR',
  'VI',
  'GU',
  'AS',
  'MP',
  'AA',
  'AE',
  'AP',
] as const;

/** USPS limits: 70 lb, and no side over 108 inches. */
export const MAX_WEIGHT_OZ = 70 * 16;
export const MAX_SIDE_IN = 108;
