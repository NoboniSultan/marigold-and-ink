import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../pricing.engine.js';
import { BusinessRuleError } from '../../../errors/index.js';

// Test rules: deliberately odd amounts so the arithmetic is visible in every assertion.
const RULES = [
  { ruleType: 'base', size: 'S', medium: 'pencil', amountCents: 1001 },
  { ruleType: 'base', size: 'L', medium: 'pencil', amountCents: 3003 },
  { ruleType: 'base', size: 'S', medium: 'paint', amountCents: 2002 },
  { ruleType: 'extra_subject', amountCents: 507 },
  { ruleType: 'rush', amountCents: 999 },
  { ruleType: 'fulfillment', fulfillmentType: 'digital', amountCents: 0 },
  { ruleType: 'fulfillment', fulfillmentType: 'physical', amountCents: 250 },
  { ruleType: 'fulfillment', fulfillmentType: 'mixed_media', amountCents: 400 },
];

const input = (overrides = {}) => ({
  size: 'S',
  medium: 'pencil',
  subjectCount: 1,
  fulfillmentType: 'digital',
  isRush: false,
  ...overrides,
});

describe('calculateQuote', () => {
  it('prices a single-subject digital piece at the base price', () => {
    expect(calculateQuote(input(), RULES)).toEqual({
      lineItems: [
        {
          code: 'base',
          label: 'S pencil portrait',
          quantity: 1,
          unitAmountCents: 1001,
          amountCents: 1001,
        },
      ],
      totalCents: 1001,
    });
  });

  it('itemizes every component for a multi-subject, rush, mixed-media piece', () => {
    const quote = calculateQuote(
      input({ size: 'L', subjectCount: 3, fulfillmentType: 'mixed_media', isRush: true }),
      RULES,
    );

    expect(quote.lineItems).toEqual([
      {
        code: 'base',
        label: 'L pencil portrait',
        quantity: 1,
        unitAmountCents: 3003,
        amountCents: 3003,
      },
      {
        code: 'extra_subject',
        label: 'Additional subject',
        quantity: 2,
        unitAmountCents: 507,
        amountCents: 1014,
      },
      {
        code: 'fulfillment',
        label: 'mixed-media fulfillment',
        quantity: 1,
        unitAmountCents: 400,
        amountCents: 400,
      },
      { code: 'rush', label: 'Rush service', quantity: 1, unitAmountCents: 999, amountCents: 999 },
    ]);
    expect(quote.totalCents).toBe(3003 + 1014 + 400 + 999);
  });

  // Every combination of the input dimensions, checked against an independent formula.
  const combos = [];
  for (const [size, medium] of [
    ['S', 'pencil'],
    ['L', 'pencil'],
    ['S', 'paint'],
  ]) {
    for (const fulfillmentType of ['digital', 'physical', 'mixed_media']) {
      for (const isRush of [false, true]) {
        for (const subjectCount of [1, 2, 5]) {
          combos.push({ size, medium, fulfillmentType, isRush, subjectCount });
        }
      }
    }
  }
  const BASE = { 'S/pencil': 1001, 'L/pencil': 3003, 'S/paint': 2002 };
  const FULFILLMENT = { digital: 0, physical: 250, mixed_media: 400 };

  it.each(combos)('$size $medium x$subjectCount $fulfillmentType rush=$isRush', (combo) => {
    const expected =
      BASE[`${combo.size}/${combo.medium}`] +
      (combo.subjectCount - 1) * 507 +
      FULFILLMENT[combo.fulfillmentType] +
      (combo.isRush ? 999 : 0);

    const quote = calculateQuote(combo, RULES);

    expect(quote.totalCents).toBe(expected);
    expect(quote.totalCents).toBe(quote.lineItems.reduce((sum, item) => sum + item.amountCents, 0));
    expect(quote.lineItems.every((item) => Number.isInteger(item.amountCents))).toBe(true);
  });

  it('omits a $0 fulfillment line but still requires the rule to exist', () => {
    expect(calculateQuote(input(), RULES).lineItems.map((i) => i.code)).toEqual(['base']);

    const withoutDigitalRule = RULES.filter((r) => r.fulfillmentType !== 'digital');
    expect(() => calculateQuote(input(), withoutDigitalRule)).toThrow(/No active price/);
  });

  it('adds no extra-subject line (and needs no rule) for a single subject', () => {
    const noExtraRule = RULES.filter((r) => r.ruleType !== 'extra_subject');
    expect(calculateQuote(input(), noExtraRule).totalCents).toBe(1001);
  });

  it.each([
    [
      'an unpriced size + medium',
      input({ size: 'XL' }),
      RULES,
      { ruleType: 'base', size: 'XL', medium: 'pencil' },
    ],
    [
      'extra subjects with no extra-subject price',
      input({ subjectCount: 2 }),
      RULES.filter((r) => r.ruleType !== 'extra_subject'),
      { ruleType: 'extra_subject' },
    ],
    [
      'rush with no rush price',
      input({ isRush: true }),
      RULES.filter((r) => r.ruleType !== 'rush'),
      { ruleType: 'rush' },
    ],
  ])('refuses to quote %s (422 PRICING_RULE_MISSING)', (_label, request, rules, details) => {
    const run = () => calculateQuote(request, rules);

    expect(run).toThrow(BusinessRuleError);
    expect(run).toThrow(
      expect.objectContaining({ status: 422, code: 'PRICING_RULE_MISSING', details }),
    );
  });

  it('refuses to guess between two active prices for the same thing', () => {
    const duplicated = [...RULES, { ruleType: 'rush', amountCents: 1 }];

    expect(() => calculateQuote(input({ isRush: true }), duplicated)).toThrow(
      expect.objectContaining({ code: 'PRICING_RULE_AMBIGUOUS' }),
    );
  });

  it('rejects a non-integer price in a rule', () => {
    const broken = RULES.map((r) => (r.ruleType === 'rush' ? { ...r, amountCents: 9.99 } : r));

    expect(() => calculateQuote(input({ isRush: true }), broken)).toThrow(TypeError);
  });

  it.each([0, 1.5, -1])('rejects subjectCount %s', (subjectCount) => {
    expect(() => calculateQuote(input({ subjectCount }), RULES)).toThrow(RangeError);
  });

  it('handles large amounts exactly', () => {
    const big = RULES.map((r) => (r.ruleType === 'base' ? { ...r, amountCents: 99_999_999 } : r));
    const quote = calculateQuote(
      input({ subjectCount: 3, isRush: true, fulfillmentType: 'physical' }),
      big,
    );

    expect(quote.totalCents).toBe(99_999_999 + 2 * 507 + 250 + 999);
  });
});
