import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config/env.js';
import { RateLimitError } from '../errors/index.js';

/**
 * Builds a rate limiter that reports `429 RATE_LIMITED` in the standard error shape and
 * sends the IETF `RateLimit` / `RateLimit-Policy` headers so clients know when to retry.
 *
 * Counters live in memory, which is correct for a single server instance. Running several
 * instances would need a shared store (e.g. Redis); see docs/backlog.md.
 */
export function createRateLimiter({ limit, windowMs, keyGenerator, skipSuccessfulRequests }) {
  return rateLimit({
    limit,
    windowMs,
    keyGenerator,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new RateLimitError()),
  });
}

function normalizedEmail(req) {
  const email = req.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Login: counts only FAILED attempts, per IP + email. One person mistyping a password
 * is fine; one IP hammering one account is not. Keying on the pair means an attacker
 * can't lock a real user out from a different IP.
 * (ipKeyGenerator groups IPv6 addresses by /56 subnet so one machine can't rotate addresses.)
 */
export const loginRateLimiter = createRateLimiter({
  ...config.rateLimits.login,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${normalizedEmail(req)}`,
});

/** Registration: per IP, every attempt counts. Slows down mass account creation. */
export const registerRateLimiter = createRateLimiter({
  ...config.rateLimits.register,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

/**
 * Password confirmation on the account page (change password, delete account): counts
 * only FAILED attempts, per signed-in user, with the login limits. Stops someone using an
 * unlocked, signed-in browser from guessing the password. Use after requireAuth.
 */
export const passwordConfirmRateLimiter = createRateLimiter({
  ...config.rateLimits.login,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `user:${req.user.id}`,
});
