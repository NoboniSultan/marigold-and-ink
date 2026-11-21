import { Link } from 'react-router';
import { COPY } from '../../content/copy.ts';
import { useTypewriter } from '../../hooks/useTypewriter.ts';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery.ts';
import buttonStyles from '../../components/Button.module.css';
import styles from './Hero.module.css';

/**
 * Home hero: one typewriter line on CSS-only notebook paper. Screen readers get all the
 * lines once, as plain text; the animated copy is hidden from them, so they don't hear
 * every keystroke.
 */
export function Hero() {
  const reduceMotion = usePrefersReducedMotion();
  const { text } = useTypewriter(COPY.heroLines, { animate: !reduceMotion });

  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <h1 id="hero-title" className="visually-hidden">
        Marigold &amp; Ink
      </h1>
      <div className={styles.paper}>
        <p className="visually-hidden">{COPY.heroLines.join(' ')}</p>
        <p className={styles.typed} aria-hidden="true">
          {text}
          <span className={reduceMotion ? styles.cursorStill : styles.cursor} />
        </p>
      </div>
      <Link to="/commission" className={`${buttonStyles.button} ${buttonStyles.primary}`}>
        {COPY.primaryCta}
      </Link>
    </section>
  );
}
