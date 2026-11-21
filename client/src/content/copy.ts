/**
 * Site text the owner writes. Everything starting with "PLACEHOLDER" is waiting for real
 * copy; replace the text and keep the structure. (Gallery and About content come from the
 * API, i.e. content/artworks.json and content/about.json.)
 */
export const COPY = {
  /** The Home hero types each line, pauses, erases it, and types the next (2–4 short lines). */
  heroLines: [
    'PLACEHOLDER: first typewriter line',
    'PLACEHOLDER: second line',
    'PLACEHOLDER: third line',
  ],
  /** The main call-to-action button (Home and header). */
  primaryCta: 'PLACEHOLDER: Commission a piece',
  /** One line in the footer about the share of every order that goes to charity. */
  charityLine: 'PLACEHOLDER: one line about the donation to charity',
} as const;
