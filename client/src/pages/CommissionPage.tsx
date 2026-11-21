import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { Commission, CommissionOptions, FulfillmentType } from '@shared/types/commission.ts';
import { fieldErrors, formMessage } from '../api/client.ts';
import { commissionsApi } from '../api/endpoints.ts';
import { useCommissionOptions } from '../api/queries.ts';
import { ErrorMessage, Loading } from '../components/Loading.tsx';
import buttonStyles from '../components/Button.module.css';
import styles from './SimplePage.module.css';

const FULFILLMENT_LABELS: Record<FulfillmentType, string> = {
  digital: 'Digital',
  physical: 'Physical',
  mixed_media: 'Mixed media',
};

const NOTES_MAX = 5000;

function CommissionForm({ options }: { options: CommissionOptions }) {
  const mediums = [...new Set(options.combinations.map((c) => c.medium))];
  const [medium, setMedium] = useState(mediums[0] ?? '');
  const sizes = options.combinations.filter((c) => c.medium === medium).map((c) => c.size);
  const [size, setSize] = useState(sizes[0] ?? '');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Commission | null>(null);

  // Keep the size valid when the medium changes (not every size exists in every medium).
  const chosenSize = sizes.includes(size) ? size : (sizes[0] ?? '');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const notes = String(form.get('notes') ?? '').trim();
      setCreated(
        await commissionsApi.create({
          medium,
          size: chosenSize,
          subjectCount: Number(form.get('subjectCount') ?? 1),
          fulfillmentType: String(form.get('fulfillmentType')) as FulfillmentType,
          isRush: form.get('isRush') === 'on',
          ...(notes ? { notes } : {}),
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className={styles.success} role="status">
        <h2>Request received</h2>
        <p>
          Request #{created.id}: {created.size} {created.medium}, {created.subjectCount}{' '}
          {created.subjectCount === 1 ? 'subject' : 'subjects'},{' '}
          {FULFILLMENT_LABELS[created.fulfillmentType].toLowerCase()}
          {created.isRush ? ', rush' : ''}.
        </p>
        <p>The next step is a quote. Nothing is charged before you accept it.</p>
        <p>
          <Link to="/gallery">Back to the gallery</Link>
        </p>
      </div>
    );
  }

  if (options.combinations.length === 0 || options.fulfillmentTypes.length === 0) {
    return <p>Commissions aren't open right now. Please check back soon.</p>;
  }

  const fields = fieldErrors(error);

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      {error ? (
        <p className={styles.formError} role="alert">
          {formMessage(error)}
        </p>
      ) : null}

      <div className={styles.field}>
        <label htmlFor="medium">Medium</label>
        <select id="medium" value={medium} onChange={(e) => setMedium(e.target.value)}>
          {mediums.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="size">Size</label>
        <select
          id="size"
          value={chosenSize}
          onChange={(e) => setSize(e.target.value)}
          aria-invalid={fields.size ? true : undefined}
        >
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {fields.size && <span className={styles.fieldError}>{fields.size}</span>}
      </div>

      <div className={styles.field}>
        <label htmlFor="subjectCount">Number of subjects</label>
        <input
          id="subjectCount"
          name="subjectCount"
          type="number"
          inputMode="numeric"
          min={1}
          max={options.multipleSubjects ? 20 : 1}
          defaultValue={1}
          readOnly={!options.multipleSubjects}
          aria-describedby={options.multipleSubjects ? undefined : 'subjects-hint'}
          aria-invalid={fields.subjectCount ? true : undefined}
        />
        {!options.multipleSubjects && (
          <span id="subjects-hint" className={styles.hint}>
            One subject per request for now.
          </span>
        )}
        {fields.subjectCount && <span className={styles.fieldError}>{fields.subjectCount}</span>}
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Delivery</legend>
        {options.fulfillmentTypes.map((type, i) => (
          <label key={type} className={styles.choice}>
            <input type="radio" name="fulfillmentType" value={type} defaultChecked={i === 0} />
            {FULFILLMENT_LABELS[type]}
          </label>
        ))}
      </fieldset>

      {options.rushAvailable && (
        <label className={styles.choice}>
          <input type="checkbox" name="isRush" />
          Rush service
        </label>
      )}

      <div className={styles.field}>
        <label htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          name="notes"
          maxLength={NOTES_MAX}
          aria-describedby="notes-hint"
          aria-invalid={fields.notes ? true : undefined}
        />
        <span id="notes-hint" className={styles.hint}>
          Tell the artist about the subject, style, and anything else that matters.
        </span>
        {fields.notes && <span className={styles.fieldError}>{fields.notes}</span>}
      </div>

      <button
        type="submit"
        className={`${buttonStyles.button} ${buttonStyles.primary}`}
        disabled={submitting}
      >
        {submitting ? 'Sending…' : 'Send request'}
      </button>
    </form>
  );
}

/** Logged-in clients request a commission. (RequireAuth sends everyone else to log in.) */
export function CommissionPage() {
  const { data, isPending, isError, refetch } = useCommissionOptions();

  return (
    <section className={`${styles.page} ${styles.wide}`}>
      <h1>Request a commission</h1>
      {isPending ? (
        <Loading label="Loading options" />
      ) : isError ? (
        <ErrorMessage message="The form couldn't load." onRetry={() => refetch()} />
      ) : (
        <CommissionForm options={data} />
      )}
    </section>
  );
}
