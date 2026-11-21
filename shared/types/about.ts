import type { ImageVariant } from './artwork.ts';

/** The About page content (from content/about.json). */
export interface AboutContent {
  photo: {
    thumb: ImageVariant;
    large: ImageVariant;
    alt: string;
  };
  /** Bio paragraphs, in order. */
  bio: string[];
  /** True while any text is still a "PLACEHOLDER:" line, so the page can flag it. */
  isPlaceholder: boolean;
}
