import privacyPolicy from '../content/privacy.md?raw';
import { Markdown } from '../components/Markdown.tsx';
import styles from './SimplePage.module.css';

/**
 * The privacy policy (/privacy), written by the owner. Its text is
 * client/src/content/privacy.md: edit that file (plain Markdown: headings, paragraphs,
 * "- " lists, **bold**, `code`, and [links](…)) to change the page.
 */
export function PrivacyPage() {
  return (
    <article className={`${styles.page} ${styles.wide} ${styles.policy}`}>
      <Markdown source={privacyPolicy} />
    </article>
  );
}
