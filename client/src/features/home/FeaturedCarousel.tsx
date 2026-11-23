import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, usePresenceData, type Variants } from 'motion/react';
import type { Artwork } from '@shared/types/artwork.ts';
import { useArtworks } from '../../api/queries.ts';
import { mixTones } from '../gallery/mixTones.ts';
import { ArtworkImage } from '../../components/ArtworkImage.tsx';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery.ts';
import styles from './FeaturedCarousel.module.css';

/** The first published artworks in gallery order (see docs/backlog.md for a "featured" flag). */
export const FEATURED_COUNT = 5;
const SWIPE_DISTANCE = 60;
const EASE = [0.4, 0, 0.2, 1] as const;

type Direction = 1 | -1;

/*
 * Three layers per slide, each with enter / center / exit variants. Variant functions get
 * the direction (1 = next, -1 = previous), so "previous" mirrors every movement.
 * Leaving: text (0s), then artwork (0.1s), then background (0.2s).
 * Arriving: background fades and scales in (0.8s); artwork slides in (0.6s, after 0.2s);
 * text drops in (0.5s, after 0.4s).
 */
const backgroundVariants: Variants = {
  enter: { opacity: 0, scale: 1.08 },
  center: { opacity: 1, scale: 1, transition: { duration: 0.8, ease: EASE } },
  exit: { opacity: 0, transition: { duration: 0.4, delay: 0.2, ease: EASE } },
};

const artworkVariants: Variants = {
  enter: (direction: Direction) => ({ x: direction > 0 ? '60%' : '-60%', opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.6, delay: 0.2, ease: EASE } },
  exit: (direction: Direction) => ({
    x: direction > 0 ? '-35%' : '35%',
    opacity: 0,
    transition: { duration: 0.4, delay: 0.1, ease: EASE },
  }),
};

const textVariants: Variants = {
  enter: { y: -24, opacity: 0 },
  center: { y: 0, opacity: 1, transition: { duration: 0.5, delay: 0.4, ease: EASE } },
  exit: { y: 12, opacity: 0, transition: { duration: 0.25, ease: EASE } },
};

/** Reduced motion: every layer simply fades. */
const fadeVariants: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.3 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

function Slide({ artwork, label }: { artwork: Artwork; label: string }) {
  // The direction AnimatePresence holds *now*, even for a slide that is already leaving.
  const direction = (usePresenceData() as Direction | undefined) ?? 1;
  const reduce = usePrefersReducedMotion();
  const pick = (variants: Variants) => (reduce ? fadeVariants : variants);

  return (
    <motion.article
      className={styles.slide}
      initial="enter"
      animate="center"
      exit="exit"
      aria-roledescription="slide"
      aria-label={label}
    >
      <motion.div
        className={styles.background}
        variants={pick(backgroundVariants)}
        custom={direction}
      >
        <img src={artwork.image.thumb.src} alt="" aria-hidden="true" />
      </motion.div>
      <motion.div className={styles.artwork} variants={pick(artworkVariants)} custom={direction}>
        <ArtworkImage
          image={artwork.image}
          sizes="(min-width: 64rem) 56rem, 80vw"
          priority
          draggable={false}
        />
      </motion.div>
      <motion.div className={styles.text} variants={pick(textVariants)} custom={direction}>
        <h2 className={styles.title}>{artwork.title}</h2>
        {artwork.medium && <p className={styles.meta}>{artwork.medium}</p>}
        {artwork.credit && <p className={styles.meta}>{artwork.credit}</p>}
        <Link to={`/gallery/${artwork.slug}`} className={styles.view}>
          View the piece
        </Link>
      </motion.div>
    </motion.article>
  );
}

function Arrow({ direction }: { direction: Direction }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" className={styles.arrowIcon}>
      <path
        d={direction > 0 ? 'M4 12h15M13 6l6 6-6 6' : 'M20 12H5M11 6l-6 6 6 6'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** User-controlled carousel (no autoplay): arrows, keyboard arrows, and swipe. */
export function FeaturedCarousel() {
  // The whole gallery (the same request as Explore, so it's cached), with black-and-white
  // and coloured pieces mixed: the gallery's own order puts every black-and-white piece first.
  const { data, isPending, isError, refetch } = useArtworks({ pageSize: 100 });
  const [[index, direction], setPage] = useState<[number, Direction]>([0, 1]);
  const reduce = usePrefersReducedMotion();

  if (isPending) return <Loading label="Loading featured work" />;
  if (isError)
    return <ErrorMessage message="Featured work couldn't load." onRetry={() => refetch()} />;

  const artworks = mixTones(data.data, (a) => a.image.monochrome).slice(0, FEATURED_COUNT);
  const count = artworks.length;
  if (count === 0) return null;

  const current = index % count;
  const artwork = artworks[current]!;
  const go = (step: Direction) => setPage([(current + step + count) % count, step]);
  const label = `${current + 1} of ${count}: ${artwork.title}`;

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') go(1);
    if (event.key === 'ArrowLeft') go(-1);
  }

  return (
    <section
      className={styles.carousel}
      aria-roledescription="carousel"
      aria-label="Featured work"
      onKeyDown={onKeyDown}
    >
      <motion.div
        className={styles.stage}
        // Swipe on touch screens: a horizontal drag past the threshold changes the slide.
        drag={reduce ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.15}
        onDragEnd={(_, info) => {
          if (info.offset.x < -SWIPE_DISTANCE) go(1);
          else if (info.offset.x > SWIPE_DISTANCE) go(-1);
        }}
      >
        <AnimatePresence initial={false} custom={direction}>
          <Slide key={artwork.id} artwork={artwork} label={label} />
        </AnimatePresence>
      </motion.div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.arrow}
          onClick={() => go(-1)}
          aria-label="Previous piece"
        >
          <Arrow direction={-1} />
        </button>
        <div className={styles.progress} aria-hidden="true">
          <span className={styles.count}>
            {String(current + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
          </span>
          <span className={styles.track}>
            <span className={styles.fill} style={{ width: `${((current + 1) / count) * 100}%` }} />
          </span>
        </div>
        <button
          type="button"
          className={styles.arrow}
          onClick={() => go(1)}
          aria-label="Next piece"
        >
          <Arrow direction={1} />
        </button>
      </div>

      {/* Announces the new slide to screen readers after a change. */}
      <p className="visually-hidden" aria-live="polite">
        {label}
      </p>
    </section>
  );
}
