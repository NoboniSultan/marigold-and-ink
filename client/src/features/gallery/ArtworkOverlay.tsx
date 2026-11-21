import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import type { Artwork } from '@shared/types/artwork.ts';
import { ArtworkImage } from '../../components/ArtworkImage.tsx';
import { useScrollLock } from '../../hooks/useScrollLock.ts';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery.ts';
import styles from './ArtworkOverlay.module.css';

export const EASE = [0.4, 0, 0.2, 1] as const;

/**
 * Full-screen detail view. Its image shares a `layoutId` with the grid card's image, so
 * Motion morphs the card into place (and back on close). Details fade in after the morph.
 * Closes with the button, Escape, or a click on the backdrop; the page behind can't scroll.
 */
export function ArtworkOverlay({ artwork, onClose }: { artwork: Artwork; onClose: () => void }) {
  const reduce = usePrefersReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);
  useScrollLock(true);

  useEffect(() => {
    // Move focus into the dialog, and give it back to whatever opened it on close.
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [onClose]);

  return (
    // The dark backdrop is its own layer, so only it fades; the image morphs at full opacity.
    <div className={styles.overlay} onClick={onClose}>
      <motion.div
        className={styles.backdrop}
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
      />
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="artwork-overlay-title"
        // Clicks inside the dialog don't count as backdrop clicks.
        onClick={(event) => event.stopPropagation()}
      >
        <motion.div
          className={styles.media}
          layoutId={reduce ? undefined : `artwork-${artwork.id}`}
          // The grid card stays mounted (hidden), so by default Motion would crossfade the
          // two; without that, the image travels at full strength.
          layoutCrossfade={false}
          transition={{ duration: 0.45, ease: EASE }}
        >
          <ArtworkImage image={artwork.image} sizes="(min-width: 64rem) 60vw, 100vw" priority />
        </motion.div>

        <motion.div
          className={styles.details}
          initial={{ opacity: 0, y: reduce ? 0 : 12 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.3, delay: reduce ? 0 : 0.3, ease: EASE },
          }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
        >
          <h2 id="artwork-overlay-title" className={styles.title}>
            {artwork.title}
          </h2>
          <dl className={styles.facts}>
            {artwork.medium && (
              <>
                <dt>Medium</dt>
                <dd>{artwork.medium}</dd>
              </>
            )}
            {artwork.year && (
              <>
                <dt>Year</dt>
                <dd>{artwork.year}</dd>
              </>
            )}
            {artwork.credit && (
              <>
                <dt>Credit</dt>
                <dd>{artwork.credit}</dd>
              </>
            )}
          </dl>
          {artwork.description && <p>{artwork.description}</p>}
          <Link to={`/gallery/${artwork.slug}`}>Open the full page</Link>
        </motion.div>

        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
