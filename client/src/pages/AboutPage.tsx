import { motion } from 'motion/react';
import { useAbout } from '../api/queries.ts';
import { ArtworkImage } from '../components/ArtworkImage.tsx';
import { ErrorMessage, Loading } from '../components/Loading.tsx';
import { InkReveal } from '../features/about/InkReveal.tsx';
import styles from './AboutPage.module.css';

/** About: the main photo (ink-spread reveal), the bio, and an optional closing photo. */
export function AboutPage() {
  const { data: about, isPending, isError, refetch } = useAbout();

  if (isPending) return <Loading label="Loading" />;
  if (isError) return <ErrorMessage message="This page couldn't load." onRetry={() => refetch()} />;

  // The bio's opening subheading ("A little about me") is the page's title; without one,
  // the page is simply "About".
  const [first, ...rest] = about.bio;
  const title = first && typeof first !== 'string' ? first.heading : 'About';
  const blocks = first && typeof first !== 'string' ? rest : about.bio;

  return (
    <article className={styles.page}>
      <div className={styles.intro}>
        <InkReveal>
          <ArtworkImage
            image={about.photo}
            sizes="(min-width: 64rem) 28rem, 100vw"
            priority
            className={styles.photo}
          />
        </InkReveal>
        <div className={styles.bio}>
          <h1>{title}</h1>
          {blocks.map((block, i) =>
            typeof block === 'string' ? <p key={i}>{block}</p> : <h2 key={i}>{block.heading}</h2>,
          )}
        </div>
      </div>

      {about.closingPhoto && (
        <motion.div
          className={styles.closing}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6 }}
        >
          <ArtworkImage image={about.closingPhoto} sizes="(min-width: 64rem) 48rem, 100vw" />
        </motion.div>
      )}
    </article>
  );
}
