import { describe, it, expect, beforeEach } from 'vitest';
import { pool } from '../pool.js';
import { seedPlaceholderPricing, PLACEHOLDER_RULES } from '../seeds/pricing.placeholder.js';
import { getActiveRules } from '../../modules/pricing/pricing.service.js';
import { calculateQuote } from '../../modules/pricing/pricing.engine.js';
import { truncateAllTables } from '../../../tests/setup/database.js';
import { createPricingRule } from '../../../tests/factories/index.js';

beforeEach(truncateAllTables);

describe('seedPlaceholderPricing', () => {
  it('fills an empty pricing table with a complete, quotable rule set', async () => {
    const result = await seedPlaceholderPricing();

    expect(result).toEqual({ skipped: false, inserted: PLACEHOLDER_RULES.length });
    const rules = await getActiveRules();
    // Every size/medium x fulfillment x rush x subjects combination can be quoted.
    for (const base of rules.filter((r) => r.ruleType === 'base')) {
      for (const fulfillmentType of ['digital', 'physical', 'mixed_media']) {
        for (const isRush of [false, true]) {
          const quote = calculateQuote(
            { size: base.size, medium: base.medium, subjectCount: 3, fulfillmentType, isRush },
            rules,
          );
          expect(quote.totalCents).toBeGreaterThan(0);
        }
      }
    }
  });

  it('is idempotent', async () => {
    await seedPlaceholderPricing();
    const second = await seedPlaceholderPricing();

    expect(second).toEqual({ skipped: true, reason: 'active pricing rules already exist' });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM pricing_rules');
    expect(rows[0].n).toBe(PLACEHOLDER_RULES.length);
  });

  it('never touches a table that already has real prices', async () => {
    await createPricingRule({ size: 'real-size', medium: 'real-medium', amountCents: 12_345 });

    expect((await seedPlaceholderPricing()).skipped).toBe(true);
    const rules = await getActiveRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].amountCents).toBe(12_345);
  });
});
