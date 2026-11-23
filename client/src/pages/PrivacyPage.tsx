import { COPY } from '../content/copy.ts';
import styles from './SimplePage.module.css';

/** The privacy policy. Its text lives in content/copy.ts, written by the owner. */
export function PrivacyPage() {
  const { lastUpdated, sections } = COPY.privacy;

  return (
    <article className={`${styles.page} ${styles.wide}`}>
      <h1>Privacy policy</h1>
      <p className={styles.hint}>Last updated: {lastUpdated}</p>
      {sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
