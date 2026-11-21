import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createPricingRule } from '../../../../tests/factories/index.js';
import { toCommissionOptions } from '../pricing.options.ts';
import type { PricingRule } from '../pricing.engine.ts';

const base = (size: string, medium: string): PricingRule => ({
  ruleType: 'base',
  size,
  medium,
  amountCents: 1000,
});

describe('toCommissionOptions', () => {
  it('lists priced size + medium pairs, fulfillment types in a fixed order, and extras', () => {
    const options = toCommissionOptions([
      base('A4', 'ink'),
      base('A3', 'graphite'),
      base('A4', 'graphite'),
      { ruleType: 'fulfillment', fulfillmentType: 'physical', amountCents: 0 },
      { ruleType: 'fulfillment', fulfillmentType: 'digital', amountCents: 0 },
      { ruleType: 'rush', amountCents: 500 },
    ]);

    expect(options).toEqual({
      combinations: [
        { size: 'A3', medium: 'graphite' },
        { size: 'A4', medium: 'graphite' },
        { size: 'A4', medium: 'ink' },
      ],
      fulfillmentTypes: ['digital', 'physical'],
      multipleSubjects: false,
      rushAvailable: true,
    });
  });

  it('offers nothing when there are no rules', () => {
    expect(toCommissionOptions([])).toEqual({
      combinations: [],
      fulfillmentTypes: [],
      multipleSubjects: false,
      rushAvailable: false,
    });
  });
});

describe('GET /api/v1/pricing/options', () => {
  beforeEach(truncateAllTables);

  it('is public and never includes prices', async () => {
    await createPricingRule({ ruleType: 'base', size: 'A4', medium: 'ink', amountCents: 6543 });
    await createPricingRule({
      ruleType: 'extra_subject',
      size: null,
      medium: null,
      amountCents: 2000,
    });

    const res = await request(createApp()).get('/api/v1/pricing/options');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      combinations: [{ size: 'A4', medium: 'ink' }],
      fulfillmentTypes: [],
      multipleSubjects: true,
      rushAvailable: false,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/6543|amount/i);
  });

  it('ignores inactive rules', async () => {
    await createPricingRule({ ruleType: 'base', size: 'A4', medium: 'ink', isActive: false });

    const res = await request(createApp()).get('/api/v1/pricing/options');

    expect(res.body.data.combinations).toEqual([]);
  });
});
