/**
 * The shipping module's rules (milestone 11, ADR 0017): which commissions ship, when the
 * address and package can change, which services are offered, and what shipping costs.
 * Pure, so they're unit-tested on their own. Owner decisions (2026-11-25): United States
 * only, USPS only to start, mixed media is delivered as files and never shipped.
 */
import type { TrackingStatus } from '@shared/types/shipping.ts';
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

// --- Labels and tracking (milestone 11b) ---

/** The label is bought once the client has paid, and before the carrier has the package. */
export function labelOpen(status: string): boolean {
  return status === 'ready_to_ship';
}

/** A label can be voided (its postage refunded) until the carrier has scanned it. */
export function voidable(trackingStatus: TrackingStatus): boolean {
  return trackingStatus === 'unknown' || trackingStatus === 'pre_transit';
}

/** Commissions whose label is still worth checking for tracking news. */
export const TRACKED_STATUSES = ['ready_to_ship', 'shipped'] as const;

/**
 * The commission status changes a package's tracking calls for, in order (owner decision
 * 2026-11-26: shipped at the carrier's first scan). Delivered as the first news moves
 * through shipped. Anything else, including a problem, changes nothing.
 */
export function trackingMoves(
  commissionStatus: string,
  trackingStatus: TrackingStatus,
): ('shipped' | 'delivered')[] {
  if (trackingStatus === 'transit') {
    return commissionStatus === 'ready_to_ship' ? ['shipped'] : [];
  }
  if (trackingStatus === 'delivered') {
    if (commissionStatus === 'ready_to_ship') return ['shipped', 'delivered'];
    if (commissionStatus === 'shipped') return ['delivered'];
  }
  return [];
}

/** Tracking news the owner should hear about: the package is coming back, or is stuck. */
export function isDeliveryProblem(trackingStatus: TrackingStatus): boolean {
  return trackingStatus === 'returned' || trackingStatus === 'failure';
}

/** Shippo's tracking takes the carrier's token ("usps"); rates name it ("USPS"). */
export function trackingCarrier(carrier: string): string {
  return carrier.trim().toLowerCase();
}
