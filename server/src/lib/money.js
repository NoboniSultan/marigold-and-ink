/**
 * Money helpers. All amounts are integer cents; floats never touch money.
 * (0.1 + 0.2 !== 0.3 in floating point, so $0.10 + $0.20 would not equal $0.30.)
 */

/** Throws unless `value` is a non-negative integer number of cents. */
export function assertCents(value, name = 'amount') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer number of cents, got ${value}`);
  }
  return value;
}

/**
 * `percent` of `amountCents`, rounded half up to the nearest cent, using integer math only.
 * Percentages may have up to two decimals (e.g. 33.33); they're converted to basis points
 * (1% = 100 bp) so the calculation never involves a fractional number of cents.
 *
 *   percentOfCents(1001, 25)  -> 250   (250.25 rounds down)
 *   percentOfCents(1002, 25)  -> 251   (250.5 rounds up)
 */
export function percentOfCents(amountCents, percent) {
  assertCents(amountCents);
  const basisPoints = Math.round(percent * 100);
  if (!Number.isFinite(percent) || basisPoints < 0 || basisPoints > 10_000) {
    throw new RangeError(`percent must be between 0 and 100, got ${percent}`);
  }
  if (Math.abs(percent * 100 - basisPoints) > 1e-9) {
    throw new RangeError(`percent may have at most two decimal places, got ${percent}`);
  }
  // amount * bp / 10000, rounded half up: add half the divisor before integer division.
  return Math.floor((amountCents * basisPoints + 5_000) / 10_000);
}

/**
 * Splits a total into a deposit (`depositPercent` of the total, rounded half up) and a
 * balance (the exact remainder), so deposit + balance always equals the total to the cent.
 */
export function splitDeposit(totalCents, depositPercent) {
  const depositCents = percentOfCents(totalCents, depositPercent);
  return { depositCents, balanceCents: totalCents - depositCents };
}

/** Sums cents, refusing anything that isn't a non-negative integer. */
export function sumCents(amounts) {
  return amounts.reduce((total, amount) => total + assertCents(amount), 0);
}

/**
 * A decimal amount written as text, as payment and shipping services send it, to exact
 * cents without passing through a float: centsFromDecimal('7.58') -> 758,
 * centsFromDecimal('12') -> 1200, centsFromDecimal('0.5') -> 50.
 */
export function centsFromDecimal(text) {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(typeof text === 'string' ? text.trim() : '');
  if (!match) throw new TypeError(`expected an amount like "12.34", got ${JSON.stringify(text)}`);
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Formats cents for display: formatCents(123456) -> "$1,234.56". Never use for calculation. */
export function formatCents(amountCents, currency = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountCents / 100);
}
