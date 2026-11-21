import * as pricingRepository from './pricing.repository.js';
import { BusinessRuleError } from '../../errors/index.js';
import { withTransaction } from '../../db/transaction.js';

/**
 * Inserts `rules` only if there are no active rules at all (used by seeds). All or
 * nothing: a failure part-way leaves the table untouched. Returns how many were inserted.
 */
export function seedRulesIfEmpty(rules) {
  return withTransaction(async (client) => {
    if ((await pricingRepository.countActive(client)) > 0) return 0;
    for (const rule of rules) await pricingRepository.insertRule(rule, client);
    return rules.length;
  });
}

export function getActiveRules(client) {
  return pricingRepository.findActiveRules(client);
}

/**
 * A commission can only be requested for a size + medium the artist has priced.
 * 422 rather than 400: the request is well-formed, but the business doesn't offer it.
 */
export async function assertOffered({ size, medium }) {
  if (!(await pricingRepository.hasActiveBaseRule({ size, medium }))) {
    throw new BusinessRuleError(`${size} ${medium} portraits aren't offered`, {
      code: 'UNSUPPORTED_SIZE_MEDIUM',
      details: { size, medium },
    });
  }
}
