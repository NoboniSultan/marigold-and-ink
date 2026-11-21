import { Link } from 'react-router';
import styles from './SimplePage.module.css';

export function NotFoundPage() {
  return (
    <section className={styles.page}>
      <h1>Page not found</h1>
      <p>That page doesn't exist, or it has moved.</p>
      <p>
        <Link to="/">Go home</Link> or <Link to="/gallery">see the gallery</Link>.
      </p>
    </section>
  );
}
