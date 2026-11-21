/**
 * The pricing engine: one pure function from a commission request and the active pricing
 * rules to itemized line items and a total, all in integer cents. No database, no HTTP,
 * no config, so every pricing combination is unit-tested directly.
 *
 * Components (one active rule each, enforced by a unique index in the database):
 *   base           size + medium, for the first subject
 *   extra_subject  per subject beyond the first
 *   fulfillment    surcharge for digital / physical / mixed_media (may be $0)
 *   rush           flat fee when rush service is requested
 *
 * A missing rule is an error, never a silent $0: undercharging because a price wasn't
 * configured would be worse than refusing to quote.
 */
import { BusinessRuleError } from '../../errors/index.js';
import { assertCents, sumCents } from '../../lib/money.js';

function findRule(rules, criteria) {
  const matches = rules.filter((rule) =>
    Object.entries(criteria).every(([key, value]) => rule[key] === value),
  );
  if (matches.length === 0) {
    throw new BusinessRuleError(`No active price for ${describe(criteria)}`, {
      code: 'PRICING_RULE_MISSING',
      details: criteria,
    });
  }
  if (matches.length > 1) {
    throw new BusinessRuleError(`More than one active price for ${describe(criteria)}`, {
      code: 'PRICING_RULE_AMBIGUOUS',
      details: criteria,
    });
  }
  return matches[0];
}

function describe(criteria) {
  return Object.values(criteria).join(' / ');
}

function lineItem(code, label, quantity, unitAmountCents) {
  assertCents(unitAmountCents, `${code} price`);
  return { code, label, quantity, unitAmountCents, amountCents: quantity * unitAmountCents };
}

/**
 * @param {{ size: string, medium: string, subjectCount: number,
 *           fulfillmentType: 'digital'|'physical'|'mixed_media', isRush: boolean }} input
 * @param {Array<{ ruleType: string, size?: string|null, medium?: string|null,
 *                 fulfillmentType?: string|null, amountCents: number }>} rules  active rules
 * @returns {{ lineItems: Array<{ code, label, quantity, unitAmountCents, amountCents }>,
 *             totalCents: number }}
 */
export function calculateQuote(input, rules) {
  const { size, medium, subjectCount, fulfillmentType, isRush } = input;
  if (!Number.isInteger(subjectCount) || subjectCount < 1) {
    throw new RangeError(`subjectCount must be a positive integer, got ${subjectCount}`);
  }

  const lineItems = [];

  const base = findRule(rules, { ruleType: 'base', size, medium });
  lineItems.push(lineItem('base', `${size} ${medium} portrait`, 1, base.amountCents));

  const extraSubjects = subjectCount - 1;
  if (extraSubjects > 0) {
    const extra = findRule(rules, { ruleType: 'extra_subject' });
    lineItems.push(
      lineItem('extra_subject', 'Additional subject', extraSubjects, extra.amountCents),
    );
  }

  const fulfillment = findRule(rules, { ruleType: 'fulfillment', fulfillmentType });
  if (fulfillment.amountCents > 0) {
    const label = `${fulfillmentType.replace('_', '-')} fulfillment`;
    lineItems.push(lineItem('fulfillment', label, 1, fulfillment.amountCents));
  }

  if (isRush) {
    const rush = findRule(rules, { ruleType: 'rush' });
    lineItems.push(lineItem('rush', 'Rush service', 1, rush.amountCents));
  }

  return { lineItems, totalCents: sumCents(lineItems.map((item) => item.amountCents)) };
}
