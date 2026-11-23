import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery.ts';
import { growthFor, nearestStage, pathAt } from './treeStages.ts';
import styles from './TreeMorph.module.css';

/**
 * Seed → sprout → tree. As the visitor scrolls the drawing into view, it grows from a seed
 * up to the stage the trees funded so far have reached (sprout at 50, full tree at 200):
 * flubber interpolates the paths, and Motion's useTransform maps scroll progress to the
 * morph. With reduced motion, the reached stage simply fades in. See docs/motion.md.
 */
export function TreeMorph({ trees }: { trees: number }) {
  const reduce = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const growth = growthFor(trees);
  // 0 when the drawing enters at the bottom of the window, 1 once it's past the middle.
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center center'] });
  const d = useTransform(scrollYProgress, (progress) => pathAt(progress * growth));

  return (
    <div ref={ref} className={styles.wrap}>
      <svg viewBox="0 0 100 100" className={styles.svg} aria-hidden="true">
        <line x1="10" y1="95" x2="90" y2="95" className={styles.ground} />
        {reduce ? (
          <motion.path
            d={nearestStage(growth)}
            className={styles.shape}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          />
        ) : (
          <motion.path d={d} className={styles.shape} />
        )}
      </svg>
      <p className={styles.count}>
        <strong>{trees.toLocaleString('en-US')}</strong> {trees === 1 ? 'tree' : 'trees'} funded so
        far
      </p>
    </div>
  );
}
