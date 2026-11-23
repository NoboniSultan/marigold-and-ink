/**
 * Explore mode: the gallery as a 3D sketchbook to page through, one artwork at a time.
 * This file (and three.js with it) is loaded only when someone opens Explore: GalleryPage
 * imports it with React.lazy, so the grid and every other page never download the 3D code.
 *
 * It owns the open spread and the input: a scroll gesture, a horizontal swipe, the arrow
 * keys, or the buttons each turn one page. Clicking the open page's artwork opens it.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import type { Artwork } from '@shared/types/artwork.ts';
import { useArtworks } from '../../../api/queries.ts';
import { ErrorMessage, Loading } from '../../../components/Loading.tsx';
import { usePrefersReducedMotion } from '../../../hooks/useMediaQuery.ts';
import { mixTones } from '../mixTones.ts';
import { Sketchbook } from './Sketchbook.tsx';
import { DRAG_THRESHOLD, clampSpread, initialWheelState, wheelStep } from './sketchbook.ts';
import styles from './ExploreCanvas.module.css';

export default function ExploreCanvas({ onOpen }: { onOpen: (artwork: Artwork) => void }) {
  const { data, isPending, isError, refetch } = useArtworks({ pageSize: 100 });
  const reduceMotion = usePrefersReducedMotion();
  // Black-and-white and coloured pieces alternate, so neither kind bunches up.
  const artworks = useMemo(
    () => (data ? mixTones(data.data, (artwork) => artwork.image.monochrome) : []),
    [data],
  );

  const [spread, setSpread] = useState(0);
  const count = artworks.length;
  const turn = (step: number) => setSpread((current) => clampSpread(current + step, count));

  // Scrolling over the book turns pages instead of scrolling the page, except at either
  // end, where the scroll carries on down (or up) the page. React's onWheel is passive
  // (it can't preventDefault), so a native listener is attached once the book exists.
  const stage = useRef<HTMLDivElement>(null);
  const spreadRef = useRef(spread);
  useEffect(() => {
    spreadRef.current = spread; // the wheel listener reads the latest spread from here
  }, [spread]);
  const ready = !isPending && !isError;
  useEffect(() => {
    const element = stage.current;
    if (!ready || !element) return;
    let state = initialWheelState;
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const atStart = spreadRef.current === 0 && delta < 0;
      const atEnd = spreadRef.current >= count - 1 && delta > 0;
      if (atStart || atEnd) return;
      event.preventDefault();
      const result = wheelStep(state, delta, event.timeStamp);
      state = result.state;
      if (result.step) setSpread((current) => clampSpread(current + result.step, count));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ready, count]);

  // A horizontal swipe or drag turns one page; vertical swipes still scroll on phones.
  const drag = useRef<{ x: number; turned: boolean } | null>(null);

  function onKeyDown(event: KeyboardEvent) {
    const keys: Record<string, () => void> = {
      ArrowRight: () => turn(1),
      ArrowLeft: () => turn(-1),
      Home: () => setSpread(0),
      End: () => setSpread(clampSpread(count - 1, count)),
    };
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  }

  if (isPending) return <Loading label="Loading artworks" />;
  if (isError)
    return <ErrorMessage message="The gallery couldn't load." onRetry={() => refetch()} />;
  if (count === 0) return <p>No artworks yet.</p>;

  const current = artworks[spread]!;

  return (
    <div className={styles.explore}>
      <div
        ref={stage}
        className={styles.stage}
        tabIndex={0}
        role="application"
        aria-roledescription="3D sketchbook"
        aria-label="Explore the gallery as a sketchbook. Use the left and right arrow keys to turn the page, and Enter to open the artwork."
        onKeyDown={(event) => {
          if (event.key === 'Enter') onOpen(current);
          else onKeyDown(event);
        }}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, turned: false };
        }}
        onPointerMove={(event) => {
          const gesture = drag.current;
          if (!gesture || gesture.turned) return;
          const dx = event.clientX - gesture.x;
          if (Math.abs(dx) >= DRAG_THRESHOLD) {
            gesture.turned = true;
            turn(dx < 0 ? 1 : -1);
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null; // the browser took the gesture over, e.g. to scroll the page
        }}
      >
        <Canvas camera={{ fov: 32, near: 0.1, far: 40 }} dpr={[1, 2]} flat>
          <Sketchbook artworks={artworks} spread={spread} instant={reduceMotion} onOpen={onOpen} />
        </Canvas>
        <p className={styles.hint} aria-hidden="true">
          <span className={styles.wide}>
            Scroll, swipe, or use the arrows to turn the page · click a piece to open it
          </span>
          <span className={styles.narrow}>Swipe to turn · tap the piece to open it</span>
        </p>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          onClick={() => turn(-1)}
          disabled={spread === 0}
          aria-label="Previous page"
        >
          ←
        </button>
        <p aria-live="polite">
          <span className={styles.title}>{current.title}</span>
          <span className={styles.position}>
            {spread + 1} of {count}
          </span>
        </p>
        <button
          type="button"
          onClick={() => turn(1)}
          disabled={spread === count - 1}
          aria-label="Next page"
        >
          →
        </button>
      </div>

      {/* The same pieces as plain buttons, for keyboards and screen readers. */}
      <ul className="visually-hidden">
        {artworks.map((artwork) => (
          <li key={artwork.id}>
            <button type="button" onClick={() => onOpen(artwork)}>
              Open {artwork.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
