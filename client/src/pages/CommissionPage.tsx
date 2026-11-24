import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { Commission, CommissionOptions, FulfillmentType } from '@shared/types/commission.ts';
import { fieldErrors, formMessage } from '../api/client.ts';
import { commissionsApi } from '../api/endpoints.ts';
import { useCommissionOptions } from '../api/queries.ts';
import { ErrorMessage, Loading } from '../components/Loading.tsx';
import buttonStyles from '../components/Button.module.css';
import styles from './SimplePage.module.css';
import { ReferencesForNewRequest } from '../features/files/CommissionFiles.tsx';

const FULFILLMENT_LABELS: Record<FulfillmentType, string> = {
  digital: 'Digital',
  physical: 'Physical',
  mixed_media: 'Mixed media',
};

const NOTES_MAX = 5000;

/** Joins the ids that describe a control, or undefined if there are none. */
function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  return ids.filter(Boolean).join(' ') || undefined;
}

/** A field's error, with the id its control points to (aria-describedby), as in FormField. */
function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <span id={id} className={styles.fieldError}>
      {message}
    </span>
  ) : null;
}

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
        <ReferencesForNewRequest commissionId={created.id} />
        <p>
          <Link to={`/commissions/${created.id}`}>View your request</Link> or go{' '}
          <Link to="/gallery">back to the gallery</Link>.
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
        <select
          id="medium"
          value={medium}
          onChange={(e) => setMedium(e.target.value)}
          aria-invalid={fields.medium ? true : undefined}
          aria-describedby={describedBy(fields.medium && 'medium-error')}
        >
          {mediums.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <FieldError id="medium-error" message={fields.medium} />
      </div>

      <div className={styles.field}>
        <label htmlFor="size">Size</label>
        <select
          id="size"
          value={chosenSize}
          onChange={(e) => setSize(e.target.value)}
          aria-invalid={fields.size ? true : undefined}
          aria-describedby={describedBy(fields.size && 'size-error')}
        >
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <FieldError id="size-error" message={fields.size} />
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
          aria-invalid={fields.subjectCount ? true : undefined}
          aria-describedby={describedBy(
            !options.multipleSubjects && 'subjects-hint',
            fields.subjectCount && 'subjectCount-error',
          )}
        />
        {!options.multipleSubjects && (
          <span id="subjects-hint" className={styles.hint}>
            One subject per request for now.
          </span>
        )}
        <FieldError id="subjectCount-error" message={fields.subjectCount} />
      </div>

      {/* A radio group's error is linked to the group, which screen readers announce on entry. */}
      <fieldset
        className={styles.fieldset}
        aria-describedby={describedBy(fields.fulfillmentType && 'fulfillmentType-error')}
      >
        <legend className={styles.legend}>Delivery</legend>
        {options.fulfillmentTypes.map((type, i) => (
          <label key={type} className={styles.choice}>
            <input
              type="radio"
              name="fulfillmentType"
              value={type}
              defaultChecked={i === 0}
              aria-invalid={fields.fulfillmentType ? true : undefined}
            />
            {FULFILLMENT_LABELS[type]}
          </label>
        ))}
        <FieldError id="fulfillmentType-error" message={fields.fulfillmentType} />
      </fieldset>

      {options.rushAvailable && (
        <div className={styles.field}>
          <label className={styles.choice}>
            <input
              type="checkbox"
              name="isRush"
              aria-invalid={fields.isRush ? true : undefined}
              aria-describedby={describedBy(fields.isRush && 'isRush-error')}
            />
            Rush service
          </label>
          <FieldError id="isRush-error" message={fields.isRush} />
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          name="notes"
          maxLength={NOTES_MAX}
          aria-invalid={fields.notes ? true : undefined}
          aria-describedby={describedBy('notes-hint', fields.notes && 'notes-error')}
        />
        <span id="notes-hint" className={styles.hint}>
          Tell the artist about the subject, style, and anything else that matters.
        </span>
        <FieldError id="notes-error" message={fields.notes} />
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
