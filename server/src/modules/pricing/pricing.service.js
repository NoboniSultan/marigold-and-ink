import * as pricingRepository from './pricing.repository.js';
import { BusinessRuleError } from '../../errors/index.js';

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
