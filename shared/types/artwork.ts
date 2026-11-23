/**
 * Gallery types shared by the API and the React client. The server checks its responses
 * against these (see gallery.service.ts), so a change here that the server doesn't follow
 * fails `npm run typecheck`.
 */

/** One generated WebP size, served by the app from /media. */
export interface ImageVariant {
  src: string;
  width: number;
  height: number;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
}

/** An artwork as the public sees it. Only published artworks are ever returned. */
export interface Artwork {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  medium: string | null;
  category: string;
  year: number | null;
  /** Attribution, e.g. "after Vincent van Gogh". */
  credit: string | null;
  image: {
    /** About 600px wide: grid cards, srcset. */
    thumb: ImageVariant;
    /** Up to 2000px on the long edge: detail view, srcset. */
    large: ImageVariant;
    alt: string;
    /** Black and white: first in the grid, mixed with coloured pieces in 3D. */
    monochrome: boolean;
  };
  /** Shown in Explore's 3D sketchbook (every published piece is in the grid). */
  inSketchbook: boolean;
  tags: Tag[];
}

/** The admin view adds publishing state; unpublished drafts may not have alt text yet. */
export interface AdminArtwork extends Omit<Artwork, 'image'> {
  image: Omit<Artwork['image'], 'alt'> & { alt: string | null };
  imageKey: string;
  isPublished: boolean;
  sortOrder: number;
  /** True when content/artworks.json owns this artwork (it can't be deleted through the API). */
  contentManaged: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A category with how many published artworks it has, for gallery filters. */
export interface CategoryCount {
  category: string;
  count: number;
}
