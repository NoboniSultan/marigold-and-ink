/**
 * Six-digit email codes. Generated with a cryptographic RNG; stored only as an HMAC (a
 * hash keyed with AUTH_SECRET), so the database never holds a usable code; compared in
 * constant time, so response timing can't reveal how close a guess was.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const CODE_LENGTH = 6;

export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/** Binding the email into the hash means a code can't be reused for another address. */
export function hashCode(email: string, code: string, secret: string): string {
  return createHmac('sha256', secret).update(`${email.toLowerCase()}:${code}`).digest('hex');
}

export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
