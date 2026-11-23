/**
 * The sketchbook on the Home page: the owner's chosen pieces (`inSketchbook`) as a 3D book
 * to page through, one artwork at a time. This file (and three.js with it) is loaded on
 * demand: Home imports it with React.lazy, so the main bundle doesn't carry the 3D code.
 *
 * It owns the open spread and the input: a sideways trackpad swipe, the arrow keys, or the
 * buttons each turn one page; a drag or touch swipe lifts the page itself, which follows
 * the finger and carries on over (or falls back) when let go. Vertical scrolling is left
 * alone, so the book never traps someone scrolling down the Home page. Clicking the open
 * page's artwork opens it.
 *
 * Without WebGL (old devices, some privacy settings, and jsdom in tests) the same book is
 * shown flat: the open piece as an image, with the same controls.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import type { Artwork } from '@shared/types/artwork.ts';
import { useArtworks } from '../../api/queries.ts';
import { ArtworkImage } from '../../components/ArtworkImage.tsx';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery.ts';
import { mixTones } from './mixTones.ts';
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
import styles from './SketchbookCanvas.module.css';

/** Can this browser draw 3D? Asked once: a WebGL context is costly to create. */
function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function SketchbookCanvas({ onOpen }: { onOpen: (artwork: Artwork) => void }) {
  const { data, isPending, isError, refetch } = useArtworks({ pageSize: 100 });
  const reduceMotion = usePrefersReducedMotion();
  const [webgl] = useState(supportsWebGL);
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

  // A sideways trackpad swipe turns a page (one per swipe); vertical scrolling scrolls the
  // Home page as usual, and so does a sideways swipe at either end of the book. React's
  // onWheel is passive (it can't preventDefault), so a native listener is attached once
  // the book exists.
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
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return; // scrolling the page
      const delta = event.deltaX;
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

  if (isPending) return <Loading label="Loading featured work" />;
  if (isError)
    return <ErrorMessage message="Featured work couldn't load." onRetry={() => refetch()} />;
  if (count === 0) return null; // nothing chosen for the book: Home shows just the hero

  const current = artworks[spread]!;

  return (
    <div className={styles.sketchbook}>
      <div
        ref={stage}
        className={styles.stage}
        tabIndex={0}
        role="application"
        aria-roledescription="3D sketchbook"
        aria-label="A sketchbook of artworks. Use the left and right arrow keys to turn the page, and Enter to open the artwork."
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
        {webgl ? (
          <Canvas camera={{ fov: 32, near: 0.1, far: 40 }} dpr={[1, 2]} flat>
            <Sketchbook
              artworks={artworks}
              spread={spread}
              instant={reduceMotion}
              dragTurn={dragTurn}
              onOpen={onOpen}
            />
          </Canvas>
        ) : (
          // No 3D: the open page, flat.
          <button type="button" className={styles.flat} onClick={() => onOpen(current)}>
            <ArtworkImage image={current.image} sizes="(min-width: 64rem) 40rem, 90vw" />
          </button>
        )}
        <p className={styles.hint} aria-hidden="true">
          <span className={styles.wide}>
            Drag, swipe, or use the arrows to turn the page · click a piece to open it
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
