/**
 * Explore mode's canvas and input handling. This file (and three.js with it) is loaded
 * only when someone opens Explore: GalleryPage imports it with React.lazy, so the grid and
 * every other page never download the 3D code.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import type { Artwork } from '@shared/types/artwork.ts';
import { useArtworks } from '../../../api/queries.ts';
import { ErrorMessage, Loading } from '../../../components/Loading.tsx';
import { ExploreScene } from './ExploreScene.tsx';
import styles from './ExploreCanvas.module.css';

const WHEEL_SPEED = 0.0025;
const DRAG_SPEED = 0.006;
const KEY_STEP = Math.PI / 12;

export default function ExploreCanvas({ onOpen }: { onOpen: (artwork: Artwork) => void }) {
  const { data, isPending, isError, refetch } = useArtworks({ pageSize: 100 });
  const container = useRef<HTMLDivElement>(null);
  const targetRotation = useRef(0);
  const drag = useRef<{ x: number } | null>(null);

  // Scrolling over the scene turns the cylinder instead of the page. React's onWheel is
  // passive (can't preventDefault), so a native listener is attached instead, once the
  // stage exists (while loading there is no stage yet, hence the `ready` dependency).
  const ready = !isPending && !isError;
  useEffect(() => {
    const element = container.current;
    if (!ready || !element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      targetRotation.current += (event.deltaY + event.deltaX) * WHEEL_SPEED;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ready]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') targetRotation.current += KEY_STEP;
    if (event.key === 'ArrowLeft') targetRotation.current -= KEY_STEP;
  }

  if (isPending) return <Loading label="Loading artworks" />;
  if (isError)
    return <ErrorMessage message="The gallery couldn't load." onRetry={() => refetch()} />;

  const artworks = data.data;

  return (
    <div className={styles.explore}>
      <div
        ref={container}
        className={styles.stage}
        tabIndex={0}
        role="application"
        aria-roledescription="3D gallery"
        aria-label="Explore the gallery in 3D. Use the left and right arrow keys to turn."
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          targetRotation.current -= (event.clientX - drag.current.x) * DRAG_SPEED;
          drag.current = { x: event.clientX };
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
      >
        <Canvas
          camera={{ position: [0, 0, 0.01], fov: 62, near: 0.1, far: 30 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
        >
          <color attach="background" args={['#29151c']} />
          <ExploreScene artworks={artworks} onOpen={onOpen} targetRotation={targetRotation} />
        </Canvas>
        <p className={styles.hint} aria-hidden="true">
          Scroll or drag to turn · click a piece to open it
        </p>
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
