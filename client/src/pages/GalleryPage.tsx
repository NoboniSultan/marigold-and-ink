import { lazy, Suspense, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, LayoutGroup } from 'motion/react';
import type { Artwork } from '@shared/types/artwork.ts';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useArtwork } from '../api/queries.ts';
import { Loading } from '../components/Loading.tsx';
import { useMediaQuery, usePrefersReducedMotion } from '../hooks/useMediaQuery.ts';
import { ArtworkOverlay } from '../features/gallery/ArtworkOverlay.tsx';
import { GalleryGrid, type GridFilters } from '../features/gallery/GalleryGrid.tsx';
import styles from './GalleryPage.module.css';

// Code-split: three.js and the 3D scene download only when Explore is opened.
const ExploreCanvas = lazy(() => import('../features/gallery/explore/ExploreCanvas.tsx'));

type Mode = 'grid' | 'explore';

/** Opens the overlay for a direct link (?art=slug) when the card isn't on screen. */
function LinkedOverlay({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { data } = useArtwork(slug);
  return data ? <ArtworkOverlay artwork={data} onClose={onClose} /> : null;
}

/**
 * Everything on this page lives in the URL (?mode, ?category, ?tag, ?q, ?page, ?art), so
 * filtered views and open artworks can be shared, and Back closes the overlay.
 */
export function GalleryPage() {
  const [params, setParams] = useSearchParams();
  const isWide = useMediaQuery('(min-width: 64rem)');
  const reduceMotion = usePrefersReducedMotion();

  // Explore is the default only on wide screens without reduced motion.
  const requested = params.get('mode');
  const mode: Mode =
    requested === 'grid' || requested === 'explore'
      ? requested
      : isWide && !reduceMotion
        ? 'explore'
        : 'grid';

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
      <div className={styles.heading}>
        <h1>Gallery</h1>
        <div className={styles.modes} role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={mode === 'grid'}
            onClick={() => update({ mode: 'grid' })}
          >
            Grid
          </button>
          <button
            type="button"
            aria-pressed={mode === 'explore'}
            onClick={() => update({ mode: 'explore' })}
          >
            Explore
          </button>
        </div>
      </div>

      <LayoutGroup>
        {mode === 'grid' ? (
          <GalleryGrid
            filters={filters}
            onFiltersChange={onFiltersChange}
            onOpen={open}
            openSlug={openSlug}
          />
        ) : (
          <Suspense fallback={<Loading label="Loading the 3D gallery" />}>
            <ExploreCanvas onOpen={open} />
          </Suspense>
        )}

        <AnimatePresence>
          {openSlug && <LinkedOverlay key={openSlug} slug={openSlug} onClose={close} />}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}
