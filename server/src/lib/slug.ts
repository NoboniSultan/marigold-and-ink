/** URL-safe slugs: lowercase words joined by single hyphens. Matches the database checks. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Turns a name into a slug: "Starry Night" → "starry-night", "Guayasamín" → "guayasamin".
 * Accents are removed by splitting letters from their marks (NFKD) and dropping the marks.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
