/**
 * What the commission form may offer, derived from the active pricing rules. Pure, and
 * deliberately price-free: the form only needs to know what can be requested, and prices
 * come from a quote (still placeholders until the owner sets real ones).
 */
import type { CommissionOptions, FulfillmentType } from '@shared/types/commission.ts';
import type { PricingRule } from './pricing.engine.ts';

const FULFILLMENT_ORDER: FulfillmentType[] = ['digital', 'physical', 'mixed_media'];

export function toCommissionOptions(rules: readonly PricingRule[]): CommissionOptions {
  const pairs = new Map<string, { size: string; medium: string }>();
  for (const rule of rules) {
    if (rule.ruleType === 'base' && rule.size && rule.medium) {
      pairs.set(`${rule.size}\u0000${rule.medium}`, { size: rule.size, medium: rule.medium });
    }
  }

  // Every request needs a fulfillment price (the engine refuses a missing one), so only
  // types with a rule are offered.
  const fulfillment = new Set(
    rules.filter((r) => r.ruleType === 'fulfillment').map((r) => r.fulfillmentType),
  );

  return {
    combinations: [...pairs.values()].sort(
      (a, b) => a.medium.localeCompare(b.medium) || a.size.localeCompare(b.size),
    ),
    fulfillmentTypes: FULFILLMENT_ORDER.filter((type) => fulfillment.has(type)),
    multipleSubjects: rules.some((r) => r.ruleType === 'extra_subject'),
    rushAvailable: rules.some((r) => r.ruleType === 'rush'),
  };
}
