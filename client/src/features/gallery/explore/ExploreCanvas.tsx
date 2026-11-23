/**
 * Explore mode: the gallery as a 3D sketchbook to page through, one artwork at a time.
 * This file (and three.js with it) is loaded only when someone opens Explore: GalleryPage
 * imports it with React.lazy, so the grid and every other page never download the 3D code.
 *
 * It owns the open spread and the input: a scroll gesture, the arrow keys, or the buttons
 * each turn one page; a sideways drag or swipe lifts the page itself, which follows the
 * finger and carries on over (or falls back) when let go. Clicking the open page's artwork
 * opens it. The book shows the pieces the owner chose for it (`inSketchbook`).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import type { Artwork } from '@shared/types/artwork.ts';
import { useArtworks } from '../../../api/queries.ts';
import { ErrorMessage, Loading } from '../../../components/Loading.tsx';
import { usePrefersReducedMotion } from '../../../hooks/useMediaQuery.ts';
import { mixTones } from '../mixTones.ts';
import { Sketchbook } from './Sketchbook.tsx';
import {
  DRAG_START,
  clampSpread,
  dragProgress,
  initialWheelState,
  releaseTurns,
  wheelStep,
  type DragTurn,
} from './sketchbook.ts';
import styles from './ExploreCanvas.module.css';

export default function ExploreCanvas({ onOpen }: { onOpen: (artwork: Artwork) => void }) {
  const { data, isPending, isError, refetch } = useArtworks({ pageSize: 100 });
  const reduceMotion = usePrefersReducedMotion();
  // The owner's picks for the book, black-and-white and coloured alternating so neither
  // kind bunches up.
  const artworks = useMemo(
    () =>
      data
        ? mixTones(
            data.data.filter((artwork) => artwork.inSketchbook),
            (artwork) => artwork.image.monochrome,
          )
        : [],
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

  // A sideways drag holds the page: forward lifts the open right-hand page, backward the
  // last turned one. Vertical swipes still scroll the page on phones (touch-action).
  const dragTurn = useRef<DragTurn | null>(null);
  const pointer = useRef<{
    startX: number;
    lastX: number;
    lastTime: number;
    velocity: number;
    span: number;
  } | null>(null);

  function letGo() {
    const held = dragTurn.current;
    const velocity = pointer.current?.velocity ?? 0;
    pointer.current = null;
    dragTurn.current = null;
    if (held && releaseTurns(held, velocity)) turn(held.direction);
  }

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
  if (count === 0) return <p>No artworks in the sketchbook yet.</p>;

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
          const { width, height } = event.currentTarget.getBoundingClientRect();
          pointer.current = {
            startX: event.clientX,
            lastX: event.clientX,
            lastTime: event.timeStamp,
            velocity: 0,
            // About a page's width on screen carries the page all the way over.
            span: width < height ? width * 0.75 : width * 0.4,
          };
        }}
        onPointerMove={(event) => {
          const press = pointer.current;
          if (!press) return;
          const elapsed = Math.max(event.timeStamp - press.lastTime, 1);
          press.velocity = 0.7 * ((event.clientX - press.lastX) / elapsed) + 0.3 * press.velocity;
          press.lastX = event.clientX;
          press.lastTime = event.timeStamp;

          const dx = event.clientX - press.startX;
          if (!dragTurn.current) {
            if (Math.abs(dx) < DRAG_START) return;
            const direction = dx < 0 ? 1 : -1;
            if (direction === 1 ? spread >= count - 1 : spread === 0) return;
            dragTurn.current = {
              leaf: direction === 1 ? spread : spread - 1,
              direction,
              progress: direction === 1 ? 0 : 1,
            };
          }
          dragTurn.current.progress = dragProgress(dx, press.span, dragTurn.current.direction);
        }}
        onPointerUp={letGo}
        onPointerLeave={letGo}
        onPointerCancel={letGo /* the browser took the gesture over, e.g. to scroll the page */}
      >
        <Canvas camera={{ fov: 32, near: 0.1, far: 40 }} dpr={[1, 2]} flat>
          <Sketchbook
            artworks={artworks}
            spread={spread}
            instant={reduceMotion}
            dragTurn={dragTurn}
            onOpen={onOpen}
          />
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
