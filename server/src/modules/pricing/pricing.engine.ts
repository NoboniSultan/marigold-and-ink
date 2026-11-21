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

/** Mirrors the `fulfillment_type` database domain. */
export type FulfillmentType = 'digital' | 'physical' | 'mixed_media';

/** Mirrors the `pricing_rules.rule_type` check; also the line-item codes. */
export type RuleType = 'base' | 'extra_subject' | 'fulfillment' | 'rush';

export interface QuoteInput {
  size: string;
  medium: string;
  subjectCount: number;
  fulfillmentType: FulfillmentType;
  isRush: boolean;
}

/** An active row from `pricing_rules`. Which optional fields are set depends on ruleType. */
export interface PricingRule {
  ruleType: RuleType;
  size?: string | null;
  medium?: string | null;
  fulfillmentType?: FulfillmentType | null;
  amountCents: number;
}

export interface LineItem {
  code: RuleType;
  label: string;
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
}

export interface Quote {
  lineItems: LineItem[];
  totalCents: number;
}

/** The fields a rule must match exactly, e.g. { ruleType: 'base', size: 'A4', medium: 'ink' }. */
type RuleCriteria = Partial<Pick<PricingRule, 'ruleType' | 'size' | 'medium' | 'fulfillmentType'>>;

function findRule(rules: readonly PricingRule[], criteria: RuleCriteria): PricingRule {
  // Object.entries loses the key types, so restore them: every key comes from RuleCriteria.
  const entries = Object.entries(criteria) as [keyof RuleCriteria, unknown][];
  const matches = rules.filter((rule) => entries.every(([key, value]) => rule[key] === value));
  const [match] = matches;

  if (!match) {
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
  return match;
}

function describe(criteria: RuleCriteria): string {
  return Object.values(criteria).join(' / ');
}

function lineItem(
  code: RuleType,
  label: string,
  quantity: number,
  unitAmountCents: number,
): LineItem {
  assertCents(unitAmountCents, `${code} price`);
  return { code, label, quantity, unitAmountCents, amountCents: quantity * unitAmountCents };
}

/** Prices a commission request against the active rules. */
export function calculateQuote(input: QuoteInput, rules: readonly PricingRule[]): Quote {
  const { size, medium, subjectCount, fulfillmentType, isRush } = input;
  if (!Number.isInteger(subjectCount) || subjectCount < 1) {
    throw new RangeError(`subjectCount must be a positive integer, got ${subjectCount}`);
  }

  const lineItems: LineItem[] = [];

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
