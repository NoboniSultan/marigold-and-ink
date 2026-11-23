import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, LayoutGroup } from 'motion/react';
import type { Artwork } from '@shared/types/artwork.ts';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useArtwork } from '../api/queries.ts';
import { ArtworkOverlay } from '../features/gallery/ArtworkOverlay.tsx';
import { GalleryGrid, type GridFilters } from '../features/gallery/GalleryGrid.tsx';
import styles from './GalleryPage.module.css';

/** Opens the overlay for a direct link (?art=slug) when the card isn't on screen. */
function LinkedOverlay({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { data } = useArtwork(slug);
  return data ? <ArtworkOverlay artwork={data} onClose={onClose} /> : null;
}

/**
 * Everything on this page lives in the URL (?category, ?tag, ?q, ?page, ?art), so
 * filtered views and open artworks can be shared, and Back closes the overlay.
 */
export function GalleryPage() {
  const [params, setParams] = useSearchParams();
  const filters: GridFilters = useMemo(
    () => ({
      category: params.get('category') ?? undefined,
      tag: params.get('tag') ?? undefined,
      q: params.get('q') ?? undefined,
      page: Math.max(1, Number(params.get('page')) || 1),
    }),
    [params],
  );
  const openSlug = params.get('art');

  const update = useCallback(
    (changes: Record<string, string | number | undefined | null>, { push = false } = {}) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (
              value === undefined ||
              value === null ||
              value === '' ||
              (key === 'page' && value === 1)
            ) {
              next.delete(key);
            } else {
              next.set(key, String(value));
            }
          }
          return next;
        },
        // Opening an artwork adds a history entry (so Back closes it); filter tweaks replace.
        { replace: !push, preventScrollReset: true },
      );
    },
    [setParams],
  );

  const queryClient = useQueryClient();
  const open = useCallback(
    (artwork: Artwork) => {
      // The card already has the data: cache it so the overlay opens (and morphs) at once.
      queryClient.setQueryData(queryKeys.artwork(artwork.slug), artwork);
      update({ art: artwork.slug }, { push: true });
    },
    [queryClient, update],
  );
  const close = useCallback(() => update({ art: null }), [update]);
  const onFiltersChange = useCallback((changes: Partial<GridFilters>) => update(changes), [update]);

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Gallery</h1>

      <LayoutGroup>
        <GalleryGrid
          filters={filters}
          onFiltersChange={onFiltersChange}
          onOpen={open}
          openSlug={openSlug}
        />

        <AnimatePresence>
          {openSlug && <LinkedOverlay key={openSlug} slug={openSlug} onClose={close} />}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}
