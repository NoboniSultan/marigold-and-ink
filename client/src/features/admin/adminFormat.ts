import type { CommissionStatus } from '@shared/types/commission.ts';
import { STATUS_TEXT } from '../commissions/statusText.ts';

/** Every commission status, in lifecycle order (the admin list's filter). */
export const STATUSES = Object.keys(STATUS_TEXT) as CommissionStatus[];

/** "awaiting_final_payment" → "Awaiting final payment". */
export function statusLabel(status: string): string {
  const words = status.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What the admin typed as dollars ("125", "125.5", "$1,250.00") → exact integer cents, or
 * null if it isn't an amount. Parsed as text, never through floating point, so 0.29
 * stays 29 cents.
 */
export function dollarsToCents(typed: string): number | null {
  const text = typed.trim().replace(/^\$/, '').replaceAll(',', '');
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** A date for the admin tables, e.g. "Nov 24, 2026", in the reader's own time zone. */
export function formatDate(iso: string | null): string {
  if (!iso) return '–';
  // A plain date (YYYY-MM-DD) is a calendar day: read it at noon so no time zone moves it.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Admin money is always US dollars. */
export const CURRENCY = 'usd';
