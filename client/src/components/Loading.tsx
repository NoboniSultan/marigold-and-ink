import styles from './Loading.module.css';

/** An accessible loading state: announced by screen readers, quiet for everyone else. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.dot} aria-hidden="true" />
      <span className="visually-hidden">{label}…</span>
    </div>
  );
}

/** A friendly error with an optional retry. */
export function ErrorMessage({
  message = 'Something went wrong.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.error} role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
