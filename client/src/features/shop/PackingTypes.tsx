/**
 * The owner's mailers and boxes (milestone 12c): name, inside size, and empty weight. Each
 * product ships in one; an order goes in the largest among its items.
 */
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PackingType, PackingTypeInput } from '@shared/types/shop.ts';
import { fieldErrors, formMessage } from '../../api/client.ts';
import { adminShopApi } from '../../api/endpoints.ts';
import { queryKeys, usePackingTypes } from '../../api/queries.ts';
import { FormField } from '../../components/FormField.tsx';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import buttonStyles from '../../components/Button.module.css';
import styles from '../../pages/admin/Admin.module.css';

const toForm = (t?: PackingType) => ({
  name: t?.name ?? '',
  lengthIn: t ? String(t.lengthIn) : '',
  widthIn: t ? String(t.widthIn) : '',
  heightIn: t ? String(t.heightIn) : '',
  weightOz: t ? String(t.weightOz) : '',
});

function PackingForm({ existing, onDone }: { existing?: PackingType; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(toForm(existing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = fieldErrors(error);
  const field = (key: keyof typeof form, label: string) => (
    <FormField
      label={label}
      inputMode="decimal"
      value={form[key]}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      error={fields[key]}
      required
    />
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body: PackingTypeInput = {
      name: form.name,
      lengthIn: Number(form.lengthIn),
      widthIn: Number(form.widthIn),
      heightIn: Number(form.heightIn),
      weightOz: Number(form.weightOz),
    };
    try {
      if (existing) await adminShopApi.updatePackingType(existing.id, body);
      else await adminShopApi.createPackingType(body);
      await queryClient.invalidateQueries({ queryKey: queryKeys.packingTypes });
      if (!existing) setForm(toForm());
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.toolbar}
      onSubmit={submit}
      aria-label={existing ? `Edit ${existing.name}` : 'Add a packing type'}
      noValidate
    >
      {error ? (
        <p className={styles.error} role="alert">
          {formMessage(error)}
        </p>
      ) : null}
      <FormField
        label="Name"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        error={fields.name}
        maxLength={60}
        required
      />
      {field('lengthIn', 'Length (in)')}
      {field('widthIn', 'Width (in)')}
      {field('heightIn', 'Height (in)')}
      {field('weightOz', 'Empty weight (oz)')}
      <button
        type="submit"
        className={`${buttonStyles.button} ${buttonStyles.secondary}`}
        disabled={busy}
      >
        {existing ? 'Save' : 'Add'}
      </button>
    </form>
  );
}

function PackingRow({ type }: { type: PackingType }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function remove() {
    if (!window.confirm(`Delete the packing type "${type.name}"?`)) return;
    setError(null);
    try {
      await adminShopApi.removePackingType(type.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.packingTypes });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <li>
      {editing ? (
        <PackingForm existing={type} onDone={() => setEditing(false)} />
      ) : (
        <div className={styles.actions}>
          <span>
            <strong>{type.name}</strong>: {type.lengthIn} × {type.widthIn} × {type.heightIn} in,{' '}
            {type.weightOz} oz empty
          </span>
          <button type="button" className={styles.linkButton} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className={styles.linkButton} onClick={remove}>
            Delete
          </button>
        </div>
      )}
      {error ? (
        <p className={styles.error} role="alert">
          {formMessage(error)}
        </p>
      ) : null}
    </li>
  );
}

export function PackingTypes() {
  const types = usePackingTypes();
  return (
    <section className={styles.section} aria-labelledby="packing-heading">
      <h2 id="packing-heading">Packing types</h2>
      <p className={styles.muted}>
        Your mailers and boxes: inside size and empty weight. Each product ships in one; an order
        goes in the largest of its items&apos;.
      </p>
      {types.isPending && <Loading label="Loading packing types" />}
      {types.isError && (
        <ErrorMessage message="Packing types couldn't load." onRetry={() => types.refetch()} />
      )}
      {types.data && types.data.length > 0 && (
        <ul className={styles.list}>
          {types.data.map((t) => (
            <PackingRow key={`${t.id}-${t.name}-${t.weightOz}`} type={t} />
          ))}
        </ul>
      )}
      <PackingForm />
    </section>
  );
}
