import type { ImageVariant } from './artwork.ts';

export interface AboutPhoto {
  thumb: ImageVariant;
  large: ImageVariant;
  alt: string;
}

/** One entry of the bio: a paragraph, or a subheading between paragraphs. */
export type AboutBioBlock = string | { heading: string };

/** The About page content (from content/about.json). */
export interface AboutContent {
  /** The main photo, at the top of the page. */
  photo: AboutPhoto;
  /** Bio paragraphs in order, with optional subheadings between them. */
  bio: AboutBioBlock[];
  /** An optional second photo for the bottom of the page. */
  closingPhoto: AboutPhoto | null;
  /** True while any text is still a "PLACEHOLDER:" line, so the page can flag it. */
  isPlaceholder: boolean;
}
