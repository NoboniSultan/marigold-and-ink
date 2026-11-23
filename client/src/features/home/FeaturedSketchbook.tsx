import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router';
import { Loading } from '../../components/Loading.tsx';
import styles from './FeaturedSketchbook.module.css';

// Code-split: three.js and the 3D book download after the rest of Home, not with every page.
const SketchbookCanvas = lazy(() => import('../sketchbook/SketchbookCanvas.tsx'));

/**
 * Home's featured work: the sketchbook (features/sketchbook), opening as the page loads.
 * Clicking the open piece goes to its page in the gallery.
 */
export function FeaturedSketchbook() {
  const navigate = useNavigate();
  return (
    <section className={styles.featured} aria-label="Featured work">
      <Suspense fallback={<Loading label="Loading featured work" />}>
        <SketchbookCanvas onOpen={(artwork) => navigate(`/gallery/${artwork.slug}`)} />
      </Suspense>
    </section>
  );
}
