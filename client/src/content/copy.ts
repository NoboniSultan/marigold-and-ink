/**
 * Site text. Everything starting with "PLACEHOLDER" is waiting for the owner's copy; replace
 * the text and keep the structure. The hero lines and button were written in milestone 7e,
 * at the owner's request, from their About text. (Gallery and About content come from the
 * API, i.e. content/artworks.json and content/about.json.)
 */
export const COPY = {
  /** The Home hero types each line, pauses, erases it, and types the next (2–4 short lines). */
  heroLines: [
    'Art you can hold onto.',
    'Charcoal, ink, acrylic, and clay.',
    'Every commission plants trees.',
  ],
  /** The main call-to-action button (Home and header). */
  primaryCta: 'Commission a piece',
  /** One line in the footer about the share of every order that goes to charity. */
  charityLine: 'With every commission, 25% goes toward planting trees.',
  /**
   * The Giving page (/giving), in the owner's words (milestone 8). Inline **bold** and
   * [link text](https://…) are supported; a block that's an array is a bulleted list.
   */
  giving: {
    title: 'Rooted in Something Bigger',
    subtitle: 'A little more good, growing beyond the canvas.',
    intro: [
      'At Marigold & Ink, I believe that art should leave something meaningful behind. Not just something beautiful to look at, but something that gives back to the world around us.',
      'For me, that begins with trees.',
    ],
    sections: [
      {
        heading: 'Why trees?',
        blocks: [
          "I've always felt a connection to trees. There's something comforting about their presence: the way they stand through changing seasons, grow at their own pace, and give so much without asking for anything in return.",
          'Trees and humans have shared an intimate relationship for as long as we can remember. They give us the air we breathe, provide shelter for countless living things, nurture ecosystems, and offer spaces for us to slow down and reconnect with nature.',
          'I find a lot of peace in being around them. And I think the world could use a little more of that.',
          'But beyond the personal connection, protecting and restoring forests is an important part of caring for our planet. Forests support biodiversity, help regulate our climate, protect soil, and sustain communities around the world.',
          'I wanted Marigold & Ink to be a small part of that effort.',
        ],
      },
      {
        heading: 'Growing something together',
        blocks: [
          "That's why I plant trees through **Digital Humani**, a Canadian nonprofit that makes it easier for businesses and digital platforms to support reforestation.",
          'Through its Reforestation as a Service (RaaS) platform, Digital Humani connects organizations like mine with trusted reforestation partners working on tree-planting projects around the world.',
          'I chose this platform because it allows me to turn a small part of every commission into a meaningful contribution toward restoring forests.',
          "**Here's how it works:**",
          [
            '**25% of every commission** is dedicated to supporting tree planting.',
            "Contributions are directed through Digital Humani's reforestation platform.",
            'Its network connects supporters with established reforestation organizations and projects.',
            'Together, these contributions help support tree planting efforts around the world.',
          ],
          'You can learn more about their work at [digitalhumani.com](https://www.digitalhumani.com/).',
        ],
      },
      {
        heading: 'A portrait that gives back',
        blocks: [
          "Every portrait begins with someone or something worth remembering. A familiar face, a beloved pet, a fleeting moment you'd like to hold onto.",
          'I love the idea that something created to preserve a little piece of your world can also contribute to protecting the world we all share.',
          "I don't expect one painting or one commission to change the world. But I believe small, intentional actions can grow into something bigger when we take them together.",
          'Thank you for being part of this little effort.',
        ],
      },
    ],
    closing: "Let's make something beautiful, and let something beautiful grow.",
  },
  // The Privacy page's text is in content/privacy.md (the owner's policy, in Markdown).
  /** The shop (milestone 12a). Products themselves are written by the owner in the admin. */
  shop: {
    title: 'Shop',
    intro: 'PLACEHOLDER: one or two lines introducing the shop.',
    /** Shown when a category (or the whole shop) has nothing in it yet. */
    empty: 'PLACEHOLDER: what to say while there is nothing in the shop.',
    /** The four categories, named as in the proposal (section 4). */
    categories: {
      jewelry: 'Handmade beaded jewelry',
      cards: 'Greeting cards',
      stickers: 'Stickers',
      upcycled: 'Upcycled thrifted pieces',
    },
  },
} as const;
