/**
 * The shop's own time zone (the owner is in New York; ADR 0015). Months in the report and
 * "today" for a payout date are counted here, so a payment at 11 pm on the 31st belongs to
 * that month, not the next one as it would in UTC.
 */
export const BUSINESS_TIME_ZONE = 'America/New_York';

/** Today's date, YYYY-MM-DD, in the shop's time zone. */
export function todayInBusinessZone(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(now);
}

/** The current year and month ("YYYY-MM") in the shop's time zone. */
export function monthInBusinessZone(now = new Date()): { year: number; month: string } {
  const month = todayInBusinessZone(now).slice(0, 7);
  return { year: Number(month.slice(0, 4)), month };
}
