import type { ImgHTMLAttributes } from 'react';
import type { ImageVariant } from '@shared/types/artwork.ts';

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'alt'> {
  image: { thumb: ImageVariant; large: ImageVariant; alt: string };
  /** How wide the image is displayed, so the browser picks the right file (srcset). */
  sizes: string;
  /** Load immediately (above the fold) instead of lazily. */
  priority?: boolean;
}

/**
 * Responsive artwork image. `srcSet` lists both generated sizes with their real widths and
 * `sizes` says how wide the image will be shown, so a phone downloads the 600px file and a
 * large screen the 2000px one. width/height reserve the space, so the page doesn't jump.
 */
export function ArtworkImage({ image, sizes, priority = false, ...rest }: Props) {
  const { thumb, large } = image;
  return (
    <img
      src={thumb.src}
      srcSet={`${thumb.src} ${thumb.width}w, ${large.src} ${large.width}w`}
      sizes={sizes}
      width={large.width}
      height={large.height}
      alt={image.alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      {...rest}
    />
  );
}
