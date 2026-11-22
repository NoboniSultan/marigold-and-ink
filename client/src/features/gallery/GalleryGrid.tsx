import { useEffect, useEffectEvent, useState } from 'react';
import { motion } from 'motion/react';
import type { Artwork } from '@shared/types/artwork.ts';
import { useArtworks, useCategories, useTags } from '../../api/queries.ts';
import { ArtworkImage } from '../../components/ArtworkImage.tsx';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery.ts';
import { EASE } from './ArtworkOverlay.tsx';
import styles from './GalleryGrid.module.css';

export const PAGE_SIZE = 24;

export interface GridFilters {
  category?: string;
  tag?: string;
  q?: string;
  page: number;
}

interface Props {
  filters: GridFilters;
  onFiltersChange: (next: Partial<GridFilters>) => void;
  onOpen: (artwork: Artwork) => void;
  /** The artwork shown in the overlay; its card hides so the image can morph out of it. */
  openSlug: string | null;
}

/** Search box that waits for a pause in typing (300ms) before searching. */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  // If the search changes elsewhere (Back button, a cleared filter), show that instead.
  // Adjusting state during render when a prop changes is React's documented pattern for this.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText(value);
  }

  // An "effect event" always sees the latest onSearch without restarting the timer.
  const search = useEffectEvent((q: string) => onSearch(q));
  useEffect(() => {
    if (text.trim() === value) return;
    const timer = setTimeout(() => search(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text, value]);

  return (
    <label className={styles.search}>
      <span className="visually-hidden">Search artworks</span>
      <input
        type="search"
        value={text}
        placeholder="Search by title, medium, or artist…"
        onChange={(event) => setText(event.target.value)}
      />
    </label>
  );
}

export function GalleryGrid({ filters, onFiltersChange, onOpen, openSlug }: Props) {
  const reduce = usePrefersReducedMotion();
  const artworks = useArtworks({ ...filters, pageSize: PAGE_SIZE });
  const categories = useCategories();
  const tags = useTags();

  const total = artworks.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // An old link or a hand-edited URL can ask for a page that no longer exists.
  const pastTheEnd = total > 0 && filters.page > pages;

  return (
    <div className={styles.wrapper}>
      <div className={styles.filters}>
        <div className={styles.chips} role="group" aria-label="Filter by category">
          <button
            type="button"
            className={styles.chip}
            aria-pressed={!filters.category}
            onClick={() => onFiltersChange({ category: undefined, page: 1 })}
          >
            All
          </button>
          {categories.data?.map(({ category, count }) => (
            <button
              key={category}
              type="button"
              className={styles.chip}
              aria-pressed={filters.category === category}
              onClick={() => onFiltersChange({ category, page: 1 })}
            >
              {category} <span className={styles.count}>{count}</span>
            </button>
          ))}
        </div>

        <div className={styles.row}>
          <SearchBox
            value={filters.q ?? ''}
            onSearch={(q) => onFiltersChange({ q: q || undefined, page: 1 })}
          />
          {tags.data && tags.data.length > 0 && (
            <label className={styles.tagSelect}>
              <span className="visually-hidden">Filter by tag</span>
              <select
                value={filters.tag ?? ''}
                onChange={(event) =>
                  onFiltersChange({ tag: event.target.value || undefined, page: 1 })
                }
              >
                <option value="">All tags</option>
                {tags.data.map((tag) => (
                  <option key={tag.slug} value={tag.slug}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {artworks.isPending ? (
        <Loading label="Loading artworks" />
      ) : artworks.isError ? (
        <ErrorMessage message="The gallery couldn't load." onRetry={() => artworks.refetch()} />
      ) : pastTheEnd ? (
        <div className={styles.empty}>
          <p>
            There's no page {filters.page}; these results end at page {pages}.
          </p>
          <button type="button" onClick={() => onFiltersChange({ page: 1 })}>
            Go to page 1
          </button>
        </div>
      ) : artworks.data.data.length === 0 ? (
        <p className={styles.empty}>No artworks match. Try another search or category.</p>
      ) : (
        <ul className={styles.grid} aria-busy={artworks.isPlaceholderData}>
          {artworks.data.data.map((artwork) => (
            <li key={artwork.id}>
              <button
                type="button"
                className={styles.card}
                onClick={() => onOpen(artwork)}
                aria-label={`Open ${artwork.title}`}
              >
                <motion.div
                  className={styles.cardImage}
                  layoutId={reduce ? undefined : `artwork-${artwork.id}`}
                  transition={{ duration: 0.45, ease: EASE }}
                  style={{ visibility: openSlug === artwork.slug ? 'hidden' : 'visible' }}
                >
                  <ArtworkImage
                    image={artwork.image}
                    sizes="(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 100vw"
                  />
                </motion.div>
                <span className={styles.caption}>
                  <span className={styles.cardTitle}>{artwork.title}</span>
                  {artwork.medium && <span className={styles.cardMeta}>{artwork.medium}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && !pastTheEnd && (
        <nav className={styles.pagination} aria-label="Gallery pages">
          <button
            type="button"
            disabled={filters.page <= 1}
            onClick={() => onFiltersChange({ page: filters.page - 1 })}
          >
            Previous
          </button>
          <span>
            Page {filters.page} of {pages}
          </span>
          <button
            type="button"
            disabled={filters.page >= pages}
            onClick={() => onFiltersChange({ page: filters.page + 1 })}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
