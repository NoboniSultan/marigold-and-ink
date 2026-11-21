import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { useArtwork } from '../api/queries.ts';
import { ArtworkImage } from '../components/ArtworkImage.tsx';
import { ErrorMessage, Loading } from '../components/Loading.tsx';
import { COPY } from '../content/copy.ts';
import buttonStyles from '../components/Button.module.css';
import { NotFoundPage } from './NotFoundPage.tsx';
import styles from './ArtworkPage.module.css';

/** A standalone page per artwork (/gallery/:slug), for sharing and direct visits. */
export function ArtworkPage() {
  const { slug = '' } = useParams();
  const { data: artwork, isPending, error, refetch } = useArtwork(slug);

  if (isPending) return <Loading label="Loading artwork" />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error)
    return <ErrorMessage message="This artwork couldn't load." onRetry={() => refetch()} />;

  return (
    <article className={styles.page}>
      <Link to="/gallery" className={styles.back}>
        ← Back to the gallery
      </Link>
      <div className={styles.layout}>
        <ArtworkImage
          image={artwork.image}
          sizes="(min-width: 64rem) 44rem, 100vw"
          priority
          className={styles.image}
        />
        <div className={styles.details}>
          <h1>{artwork.title}</h1>
          <dl className={styles.facts}>
            {artwork.medium && (
              <>
                <dt>Medium</dt>
                <dd>{artwork.medium}</dd>
              </>
            )}
            <dt>Category</dt>
            <dd className={styles.capitalize}>{artwork.category}</dd>
            {artwork.year && (
              <>
                <dt>Year</dt>
                <dd>{artwork.year}</dd>
              </>
            )}
            {artwork.credit && (
              <>
                <dt>Credit</dt>
                <dd>{artwork.credit}</dd>
              </>
            )}
          </dl>
          {artwork.description && <p>{artwork.description}</p>}
          {artwork.tags.length > 0 && (
            <ul className={styles.tags} aria-label="Tags">
              {artwork.tags.map((tag) => (
                <li key={tag.slug}>
                  <Link to={`/gallery?mode=grid&tag=${tag.slug}`}>{tag.name}</Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/commission" className={`${buttonStyles.button} ${buttonStyles.primary}`}>
            {COPY.primaryCta}
          </Link>
        </div>
      </div>
    </article>
  );
}
