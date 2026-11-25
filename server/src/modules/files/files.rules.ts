/**
 * The files module's rules (milestone 10, ADR 0016): what may be uploaded, when, by whom,
 * who sees what, and when files are deleted. Pure, so they're unit-tested on their own.
 * The limits and keeping periods are the owner's decisions (2026-11-24).
 */
import type { DetectedType } from './files.processing.ts';

export type FileKind = 'reference' | 'preview' | 'final';

export const REFERENCE_LIMIT = 10;
const MB = 1024 * 1024;
export const REFERENCE_MAX_BYTES = 15 * MB;
export const PREVIEW_MAX_BYTES = 25 * MB;
export const FINAL_MAX_BYTES = 100 * MB;

/** Reference photos are kept this long after the commission ends (owner, 2026-11-24). */
export const REFERENCE_KEEP_DAYS = 90;
/** Previews and final files stay downloadable this long after full payment (owner). */
export const DELIVERABLE_KEEP_DAYS = 365;

/** Signed links last this long; the page asks for fresh ones each time it loads. */
export const LINK_SECONDS = 10 * 60;

export const ALLOWED_TYPES: Record<FileKind, readonly DetectedType[]> = {
  // iPhones turn HEIC photos into JPEG when a web page asks for one (ADR 0016).
  reference: ['image/jpeg', 'image/png', 'image/webp'],
  preview: ['image/jpeg', 'image/png', 'image/webp', 'image/tiff'],
  final: ['image/jpeg', 'image/png', 'application/pdf', 'image/tiff'],
};

export const EXTENSIONS: Record<DetectedType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/tiff': 'tif',
  'application/pdf': 'pdf',
};

/** Clients add or remove reference photos from the request until work starts. */
export const REFERENCE_STATUSES = ['inquiry', 'quoted', 'deposit_paid'] as const;

/** Previews and finals: once the deposit is paid, while the commission is still going. */
export function acceptsDeliverables(status: string): boolean {
  return !['inquiry', 'quoted', 'canceled', 'refunded'].includes(status);
}

/** Paid in full: the client may download final files. */
export const PAID_IN_FULL_STATUSES = ['ready_to_ship', 'shipped', 'delivered', 'completed'];

export function referencesOpen(status: string): boolean {
  return (REFERENCE_STATUSES as readonly string[]).includes(status);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const plusDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/**
 * When a file is deleted, or null while that isn't known yet:
 * - reference photos: 90 days after the commission ends (completed, cancelled, refunded);
 * - previews and finals: a year after full payment, or, for a commission that ended
 *   without being paid in full, 90 days after it ended.
 */
export function deleteAfter(
  kind: FileKind,
  { paidInFullAt, endedAt }: { paidInFullAt: Date | null; endedAt: Date | null },
): Date | null {
  if (kind !== 'reference' && paidInFullAt) return plusDays(paidInFullAt, DELIVERABLE_KEEP_DAYS);
  return endedAt ? plusDays(endedAt, REFERENCE_KEEP_DAYS) : null;
}
