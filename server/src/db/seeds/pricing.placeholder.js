/**
 * ⚠️  PLACEHOLDER PRICES — NOT THE ARTIST'S REAL PRICE LIST.
 *
 * Sample data so commissions can be requested and quoted while the real prices are
 * pending. Inserted only when there are NO active pricing rules, so once real prices
 * exist this seed can never overwrite or mix with them.
 *
 * To switch to real prices: deactivate these rules (is_active = false) and insert the
 * real ones, or replace the table's contents in a migration. Tracked in docs/backlog.md.
 */
import * as pricingService from '../../modules/pricing/pricing.service.js';

const dollars = (amount) => Math.round(amount * 100);

const SIZES = { A5: 40, A4: 60, A3: 90 }; // placeholder base prices by size (graphite)
const MEDIUM_ADJUSTMENT = { graphite: 0, ink: 5, digital: -5 }; // placeholder

export const PLACEHOLDER_RULES = [
  ...Object.entries(SIZES).flatMap(([size, base]) =>
    Object.entries(MEDIUM_ADJUSTMENT).map(([medium, adjustment]) => ({
      ruleType: 'base',
      size,
      medium,
      amountCents: dollars(base + adjustment),
    })),
  ),
  { ruleType: 'extra_subject', amountCents: dollars(20) },
  { ruleType: 'rush', amountCents: dollars(25) },
  { ruleType: 'fulfillment', fulfillmentType: 'digital', amountCents: 0 },
  { ruleType: 'fulfillment', fulfillmentType: 'physical', amountCents: dollars(15) },
  { ruleType: 'fulfillment', fulfillmentType: 'mixed_media', amountCents: dollars(20) },
];

export async function seedPlaceholderPricing() {
  const inserted = await pricingService.seedRulesIfEmpty(PLACEHOLDER_RULES);
  return inserted === 0
    ? { skipped: true, reason: 'active pricing rules already exist' }
    : { skipped: false, inserted };
}
