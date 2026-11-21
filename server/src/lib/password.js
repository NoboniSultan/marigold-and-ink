import bcrypt from 'bcrypt';
import { config } from '../config/env.js';

/**
 * bcrypt is deliberately slow (cost factor = 2^rounds iterations), which makes
 * brute-forcing a stolen hash expensive. It also embeds a random salt in each hash,
 * so two users with the same password get different hashes.
 */
export function hashPassword(password, rounds = config.bcryptRounds) {
  return bcrypt.hash(password, rounds);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
