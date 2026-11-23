/**
 * Site text. Everything starting with "PLACEHOLDER" is waiting for the owner's copy; replace
 * the text and keep the structure. The hero lines and button were written in milestone 7e,
 * at the owner's request, from their About text. (Gallery and About content come from the
 * API, i.e. content/artworks.json and content/about.json.)
 */
export const COPY = {
  /** The Home hero types each line, pauses, erases it, and types the next (2–4 short lines). */
  heroLines: [
    'Faces hold entire stories.',
    'Art you can hold onto.',
    'Charcoal, ink, acrylic, and clay.',
    'Every commission plants trees.',
  ],
  /** The main call-to-action button (Home and header). */
  primaryCta: 'Commission a piece',
  /** One line in the footer about the share of every order that goes to charity. */
  charityLine: 'With every commission, 25% goes toward planting trees.',
  /**
   * The Privacy page (/privacy). Google requires a public privacy policy before the app can
   * be published. docs/privacy-data-inventory.md lists what the site actually collects.
   */
  privacy: {
    lastUpdated: 'PLACEHOLDER: the date this policy last changed',
    sections: [
      {
        heading: 'PLACEHOLDER: What you collect',
        paragraphs: ['PLACEHOLDER: accounts, commission requests, payments (see the inventory)'],
      },
      {
        heading: 'PLACEHOLDER: Who you share it with',
        paragraphs: ['PLACEHOLDER: Render, Neon, Stripe, Google, Resend, and why'],
      },
      {
        heading: 'PLACEHOLDER: Cookies',
        paragraphs: ['PLACEHOLDER: the one sign-in cookie; no analytics or advertising'],
      },
      {
        heading: 'PLACEHOLDER: Your choices and how to contact you',
        paragraphs: ['PLACEHOLDER: how to ask for a copy or deletion of your data'],
      },
    ],
  },
} as const;
