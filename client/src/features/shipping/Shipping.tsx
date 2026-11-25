/**
 * Shipping a physical commission (milestone 11, ADR 0017): the client's address and choice of
 * shipping on their commission page, and the admin's Shipping section with the package.
 * Every price shown comes from the server (live postage plus the owner's packaging fee).
 */
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  Shipment,
  ShippingAddress,
  ShippingMeta,
  ShippingOption,
} from '@shared/types/shipping.ts';
import { ApiError, fieldErrors, formMessage } from '../../api/client.ts';
import { shippingApi } from '../../api/endpoints.ts';
import { queryKeys, useShipping } from '../../api/queries.ts';
import { FormField } from '../../components/FormField.tsx';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import buttonStyles from '../../components/Button.module.css';
import pageStyles from '../../pages/SimplePage.module.css';
import adminStyles from '../../pages/admin/Admin.module.css';
import { formatMoney } from '../commissions/money.ts';
import { US_STATES } from './states.ts';

const usd = (cents: number) => formatMoney(cents, 'usd');

/** The carrier's reasons an address was refused, if it sent any. */
function addressProblems(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'ADDRESS_NOT_DELIVERABLE') return [];
  const messages = (error.details as { messages?: unknown } | undefined)?.messages;
  return Array.isArray(messages) ? messages.filter((m): m is string => typeof m === 'string') : [];
}

function AddressLines({ address }: { address: ShippingAddress }) {
  return (
    <address>
      {address.name}
      <br />
      {address.line1}
      {address.line2 ? (
        <>
          <br />
          {address.line2}
        </>
      ) : null}
      <br />
      {address.city}, {address.state} {address.postalCode}
    </address>
  );
}

function AddressForm({
  commissionId,
  initial,
  onDone,
}: {
  commissionId: number;
  initial: ShippingAddress | null;
  onDone: (() => void) | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    line1: initial?.line1 ?? '',
    line2: initial?.line2 ?? '',
    city: initial?.city ?? '',
    state: initial?.state ?? '',
    postalCode: initial?.postalCode ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = fieldErrors(error);
  const problems = addressProblems(error);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await shippingApi.setAddress(commissionId, { ...form, line2: form.line2 || null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.shipping(commissionId) });
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={pageStyles.form} onSubmit={submit} aria-label="Shipping address" noValidate>
      {error ? (
        <div className={pageStyles.formError} role="alert">
          <p>{formMessage(error)}</p>
          {problems.length > 0 && (
            <ul>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      <FormField
        label="Full name"
        autoComplete="shipping name"
        value={form.name}
        onChange={(e) => set('name')(e.target.value)}
        error={fields.name}
        maxLength={100}
        required
      />
      <FormField
        label="Street address"
        autoComplete="shipping address-line1"
        value={form.line1}
        onChange={(e) => set('line1')(e.target.value)}
        error={fields.line1}
        maxLength={100}
        required
      />
      <FormField
        label="Apartment, suite, or unit (optional)"
        autoComplete="shipping address-line2"
        value={form.line2}
        onChange={(e) => set('line2')(e.target.value)}
        error={fields.line2}
        maxLength={100}
      />
      <FormField
        label="City"
        autoComplete="shipping address-level2"
        value={form.city}
        onChange={(e) => set('city')(e.target.value)}
        error={fields.city}
        maxLength={60}
        required
      />
      <div className={pageStyles.field}>
        <label htmlFor={`state-${commissionId}`}>State</label>
        <select
          id={`state-${commissionId}`}
          autoComplete="shipping address-level1"
          value={form.state}
          onChange={(e) => set('state')(e.target.value)}
          aria-invalid={fields.state ? true : undefined}
          aria-describedby={fields.state ? `state-${commissionId}-error` : undefined}
          required
        >
          <option value="">Choose…</option>
          {US_STATES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        {fields.state && (
          <span id={`state-${commissionId}-error`} className={pageStyles.fieldError}>
            {fields.state}
          </span>
        )}
      </div>
      <FormField
        label="ZIP code"
        autoComplete="shipping postal-code"
        inputMode="numeric"
        value={form.postalCode}
        onChange={(e) => set('postalCode')(e.target.value)}
        error={fields.postalCode}
        maxLength={10}
        required
      />
      <div className={pageStyles.row}>
        <button
          type="submit"
          className={`${buttonStyles.button} ${buttonStyles.primary}`}
          disabled={saving}
        >
          {saving ? 'Checking the address…' : 'Save address'}
        </button>
        {onDone && initial ? (
          <button
            type="button"
            className={`${buttonStyles.button} ${buttonStyles.secondary}`}
            onClick={onDone}
          >
            Cancel
          </button>
        ) : null}
      </div>
      <p className={pageStyles.hint}>We ship within the United States only.</p>
    </form>
  );
}

/** The address: a form while it can change and isn't set (or is being changed), else the lines. */
function AddressPart({
  commissionId,
  shipment,
  meta,
}: {
  commissionId: number;
  shipment: Shipment | null;
  meta: ShippingMeta;
}) {
  const [editing, setEditing] = useState(false);
  const address = shipment?.address ?? null;

  if (meta.addressOpen && (editing || !address)) {
    return (
      <AddressForm
        commissionId={commissionId}
        initial={address}
        onDone={address ? () => setEditing(false) : null}
      />
    );
  }
  if (!address) return <p className={pageStyles.hint}>No shipping address yet.</p>;
  return (
    <div>
      <AddressLines address={address} />
      {meta.addressOpen && (
        <button
          type="button"
          className={`${buttonStyles.button} ${buttonStyles.secondary}`}
          onClick={() => setEditing(true)}
        >
          Change address
        </button>
      )}
    </div>
  );
}

function describeOption(option: Omit<ShippingOption, 'rateId'>) {
  const days =
    option.estimatedDays === null
      ? ''
      : `, about ${option.estimatedDays} business day${option.estimatedDays === 1 ? '' : 's'}`;
  return `${option.carrier} ${option.serviceName}${days}`;
}

function Breakdown({ option }: { option: Omit<ShippingOption, 'rateId'> }) {
  return (
    <>
      {usd(option.postageCents)} postage
      {option.packagingFeeCents > 0 ? ` + ${usd(option.packagingFeeCents)} packaging` : ''} ={' '}
      <strong>{usd(option.totalCents)}</strong>
    </>
  );
}

/** While the balance is due: live prices, then the client's choice. */
function ChoosePart({ commissionId, shipment }: { commissionId: number; shipment: Shipment }) {
  const queryClient = useQueryClient();
  const [options, setOptions] = useState<ShippingOption[] | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!shipment.package) {
    return (
      <p className={pageStyles.notice}>
        We&apos;re adding the package details. Shipping prices will appear here soon.
      </p>
    );
  }

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const list = await shippingApi.options(commissionId);
      setOptions(list);
      setSelected(list[0]?.rateId ?? '');
      // Fetching prices forgets an earlier choice on the server.
      await queryClient.invalidateQueries({ queryKey: queryKeys.shipping(commissionId) });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function choose(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await shippingApi.choose(commissionId, selected);
      setOptions(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.shipping(commissionId) });
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.code === 'SHIPPING_OPTION_STALE') setOptions(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={pageStyles.form}>
      {error ? (
        <p className={pageStyles.formError} role="alert">
          {formMessage(error)}
        </p>
      ) : null}
      {shipment.chosen && !options ? (
        <p>
          Shipping: {describeOption(shipment.chosen)}. <Breakdown option={shipment.chosen} />
        </p>
      ) : null}
      {options ? (
        <form onSubmit={choose} aria-label="Shipping options">
          <fieldset className={pageStyles.fieldset}>
            <legend className={pageStyles.legend}>Choose shipping</legend>
            {options.map((option) => (
              <label key={option.rateId} className={pageStyles.choice}>
                <input
                  type="radio"
                  name={`shipping-${commissionId}`}
                  value={option.rateId}
                  checked={selected === option.rateId}
                  onChange={() => setSelected(option.rateId)}
                />
                <span>
                  {describeOption(option)}: <Breakdown option={option} />
                </span>
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            className={`${buttonStyles.button} ${buttonStyles.primary}`}
            disabled={busy || !selected}
          >
            Use this option
          </button>
        </form>
      ) : (
        <button
          type="button"
          className={`${buttonStyles.button} ${buttonStyles.secondary}`}
          onClick={load}
          disabled={busy}
        >
          {busy
            ? 'Getting prices…'
            : shipment.chosen
              ? 'Change shipping option'
              : 'See shipping options'}
        </button>
      )}
    </div>
  );
}

/** The client's commission page: nothing for work delivered as files. */
export function ClientShipping({ commissionId }: { commissionId: number }) {
  const shipping = useShipping(commissionId);

  if (shipping.isPending) return <Loading label="Loading shipping" />;
  if (shipping.isError) {
    return <ErrorMessage message="Shipping couldn't load." onRetry={() => shipping.refetch()} />;
  }
  const { data: shipment, meta } = shipping.data;
  if (!meta.ships) return null;

  return (
    <section aria-labelledby="shipping-heading">
      <h2 id="shipping-heading">Shipping</h2>
      {!meta.shippingEnabled ? (
        <p className={pageStyles.notice}>Shipping options open soon.</p>
      ) : (
        <>
          <AddressPart commissionId={commissionId} shipment={shipment} meta={meta} />
          {meta.choosingOpen && shipment?.address ? (
            <ChoosePart commissionId={commissionId} shipment={shipment} />
          ) : null}
          {meta.addressOpen && !meta.choosingOpen ? (
            <p className={pageStyles.hint}>
              You&apos;ll choose a shipping option when the balance is due.
            </p>
          ) : null}
          {!meta.addressOpen && !meta.choosingOpen && shipment?.chosen ? (
            <p>
              Shipping: {describeOption(shipment.chosen)}. <Breakdown option={shipment.chosen} />
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * What the final payment adds for shipping (null until chosen). `physical` comes from the
 * commission, so work delivered as files never asks.
 */
export function useShippingCharge(commissionId: number, physical: boolean) {
  const shipping = useShipping(commissionId, { enabled: physical });
  const ships = shipping.data?.meta.ships ?? false;
  return {
    ships,
    enabled: shipping.data?.meta.shippingEnabled ?? false,
    chosenCents: shipping.data?.data?.chosen?.totalCents ?? null,
  };
}

// --- Admin ---

function PackageForm({
  commissionId,
  shipment,
}: {
  commissionId: number;
  shipment: Shipment | null;
}) {
  const queryClient = useQueryClient();
  const current = shipment?.package;
  const [form, setForm] = useState({
    weightOz: current ? String(current.weightOz) : '',
    lengthIn: current ? String(current.lengthIn) : '',
    widthIn: current ? String(current.widthIn) : '',
    heightIn: current ? String(current.heightIn) : '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const fields = fieldErrors(error);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await shippingApi.setPackage(commissionId, {
        weightOz: Number(form.weightOz),
        lengthIn: Number(form.lengthIn),
        widthIn: Number(form.widthIn),
        heightIn: Number(form.heightIn),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.shipping(commissionId) });
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof typeof form, label: string) => (
    <FormField
      label={label}
      type="number"
      inputMode="decimal"
      min="0.01"
      step="0.01"
      value={form[key]}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      error={fields[key]}
      required
    />
  );

  return (
    <form className={adminStyles.form} onSubmit={submit} aria-label="Package" noValidate>
      <h3>Package</h3>
      {error ? (
        <p className={adminStyles.error} role="alert">
          {formMessage(error)}
        </p>
      ) : null}
      {field('weightOz', 'Weight (ounces, packed)')}
      {field('lengthIn', 'Length (inches)')}
      {field('widthIn', 'Width (inches)')}
      {field('heightIn', 'Height (inches)')}
      <button
        type="submit"
        className={`${buttonStyles.button} ${buttonStyles.primary}`}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save package'}
      </button>
      {saved && (
        <p className={adminStyles.status} role="status">
          Saved. Any shipping option the client chose before is cleared.
        </p>
      )}
    </form>
  );
}

/** The admin commission page's Shipping section (physical work only). */
export function AdminShipping({ commissionId }: { commissionId: number }) {
  const shipping = useShipping(commissionId);

  if (shipping.isPending) return <Loading label="Loading shipping" />;
  if (shipping.isError) {
    return <ErrorMessage message="Shipping couldn't load." onRetry={() => shipping.refetch()} />;
  }
  const { data: shipment, meta } = shipping.data;
  if (!meta.ships) return null;

  return (
    <section className={adminStyles.section} aria-labelledby="shipping-heading">
      <h2 id="shipping-heading">Shipping</h2>
      {!meta.shippingEnabled ? (
        <p className={adminStyles.muted}>
          Shipping is off until Shippo is set up (docs/setup-shippo.md). Physical commissions
          can&apos;t take their final payment until then.
        </p>
      ) : (
        <>
          <h3>Address</h3>
          {shipment?.addressRemovedAt ? (
            <p className={adminStyles.muted}>
              Removed when the client deleted their account (the city, state, and ZIP are kept for
              records).
            </p>
          ) : (
            <AddressPart commissionId={commissionId} shipment={shipment} meta={meta} />
          )}
          {meta.addressOpen ? (
            <PackageForm
              key={JSON.stringify(shipment?.package ?? null)}
              commissionId={commissionId}
              shipment={shipment}
            />
          ) : shipment?.package ? (
            <p>
              Package: {shipment.package.weightOz} oz, {shipment.package.lengthIn} ×{' '}
              {shipment.package.widthIn} × {shipment.package.heightIn} in
            </p>
          ) : null}
          <h3>Client&apos;s choice</h3>
          {shipment?.chosen ? (
            <p>
              {describeOption(shipment.chosen)}. <Breakdown option={shipment.chosen} />
            </p>
          ) : (
            <p className={adminStyles.muted}>
              {meta.choosingOpen
                ? 'Not chosen yet. The client chooses while the balance is due.'
                : 'The client chooses once the balance is due.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}
