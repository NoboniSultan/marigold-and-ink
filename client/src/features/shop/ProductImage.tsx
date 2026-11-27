import type { ProductPhoto } from '@shared/types/shop.ts';

/**
 * A product photo from the shop's two sizes (about 600 px, and at most 1600 px). The browser
 * picks the size from `sizes`. Width and height keep the layout from jumping while it loads.
 */
export function ProductImage({
  photo,
  sizes,
  className,
  priority = false,
}: {
  photo: ProductPhoto;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  const smallWidth = Math.min(600, photo.width);
  return (
    <img
      src={photo.smallUrl}
      srcSet={`${photo.smallUrl} ${smallWidth}w, ${photo.largeUrl} ${photo.width}w`}
      sizes={sizes}
      width={photo.width}
      height={photo.height}
      alt={photo.altText ?? ''}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={className}
    />
  );
}
