import { Link } from 'react-router';
import { COPY } from '../content/copy.ts';
import styles from './Footer.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <img
          src="/brand/logo-256.webp"
          width={96}
          height={96}
          alt=""
          className={styles.logo}
          loading="lazy"
        />
        <div>
          <p className={styles.charity}>{COPY.charityLine}</p>
          <nav aria-label="Footer" className={styles.links}>
            <Link to="/gallery">Gallery</Link>
            <Link to="/about">About</Link>
            <Link to="/commission">Commission</Link>
          </nav>
          <p className={styles.legal}>
            © {new Date().getFullYear()} Marigold &amp; Ink. All artwork © the artist.
          </p>
        </div>
      </div>
    </footer>
  );
}
