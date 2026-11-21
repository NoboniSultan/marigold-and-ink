import { useRef, type ReactNode } from 'react';
import { motion, useInView } from 'motion/react';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery.ts';
import styles from './InkReveal.module.css';

/**
 * Reveals its content through an ink blot that spreads from the centre, once, the first
 * time it scrolls into view. The blot is a CSS mask (an irregular SVG shape); Motion animates
 * the CSS variable --ink from 0 to 1, and the stylesheet turns that into the mask's size.
 * With reduced motion, the content simply fades in.
 */
export function InkReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduce = usePrefersReducedMotion();

  if (reduce) {
    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : undefined}
        transition={{ duration: 0.4 }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className={styles.ink}
      initial={{ '--ink': 0 }}
      animate={inView ? { '--ink': 1 } : undefined}
      transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
