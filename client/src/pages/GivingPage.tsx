import { COPY } from '../content/copy.ts';
import { useGiving } from '../api/queries.ts';
import { RichText } from '../components/RichText.tsx';
import { TreeMorph } from '../features/giving/TreeMorph.tsx';
import styles from './SimplePage.module.css';

/** Where the 25% goes: the owner's words, and a tree that grows with the trees funded. */
export function GivingPage() {
  const { title, subtitle, intro, sections, closing } = COPY.giving;
  const giving = useGiving();

  return (
    <article className={`${styles.page} ${styles.wide}`}>
      <h1>{title}</h1>
      <p className={styles.lead}>{subtitle}</p>
      {intro.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}

      {/* The count comes from the API; without it the page still reads fine, so no error box. */}
      {giving.data && <TreeMorph trees={giving.data.trees} />}

      {sections.map((section) => (
        <section key={section.heading} className={styles.section}>
          <h2>{section.heading}</h2>
          {section.blocks.map((block, i) =>
            typeof block === 'string' ? (
              <p key={i}>
                <RichText text={block} />
              </p>
            ) : (
              <ul key={i} className={styles.list}>
                {block.map((item) => (
                  <li key={item}>
                    <RichText text={item} />
                  </li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}

      <p className={styles.section}>
        <strong>{closing}</strong>
      </p>
    </article>
  );
}
