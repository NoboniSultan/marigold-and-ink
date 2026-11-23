import { ensureCharity } from '../../modules/giving/giving.service.ts';

/**
 * Makes sure an active charity exists, so every donation has one to point at. Idempotent,
 * and it never replaces a charity the owner made active since.
 */
export function seedCharity() {
  return ensureCharity();
}
