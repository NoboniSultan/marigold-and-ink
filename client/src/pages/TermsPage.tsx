import termsOfService from '../content/terms.md?raw';
import { Markdown } from '../components/Markdown.tsx';
import styles from './SimplePage.module.css';

/**
 * The terms of service (/terms), written by the owner. Its text is
 * client/src/content/terms.md, in the same plain Markdown as the privacy policy.
 */
export function TermsPage() {
  return (
    <article className={`${styles.page} ${styles.wide} ${styles.policy}`}>
      <Markdown source={termsOfService} />
    </article>
  );
}
