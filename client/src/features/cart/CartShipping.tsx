/**
 * The cart's shipping step (milestone 12c): where the order goes (US only, checked by the
 * carrier) and which USPS service, priced live for the packed order with the packaging fee.
 * The address is filled in from the client's last shipped order when there is one.
 */
import { useState, type FormEvent } from 'react';
import type { CartLine, CartShippingOption, CartShippingQuote } from '@shared/types/order.ts';
import type { ShippingAddress } from '@shared/types/shipping.ts';
import { fieldErrors, formMessage } from '../../api/client.ts';
import { cartApi } from '../../api/endpoints.ts';
import { useLastAddress } from '../../api/queries.ts';
import { FormField } from '../../components/FormField.tsx';
import buttonStyles from '../../components/Button.module.css';
import pageStyles from '../../pages/SimplePage.module.css';
import { addressProblems } from '../shipping/Shipping.tsx';
import { US_STATES } from '../shipping/states.ts';
import { usd } from '../shop/shopFormat.ts';

export interface ShippingChoice {
  /** As the carrier standardized it. */
  address: ShippingAddress;
  option: CartShippingOption;
}

const EMPTY = { name: '', line1: '', line2: '', city: '', state: '', postalCode: '' };

function days(option: CartShippingOption) {
  if (option.estimatedDays === null) return '';
  return `, about ${option.estimatedDays} business day${option.estimatedDays === 1 ? '' : 's'}`;
}

export function CartShipping({
  lines,
  onChoose,
  resetKey,
}: {
  lines: CartLine[];
  onChoose: (choice: ShippingChoice | null) => void;
  /** Changes when the choice must be made again (e.g. its price changed at checkout). */
  resetKey: number;
}) {
  const last = useLastAddress({ enabled: true });
  const [form, setForm] = useState(EMPTY);
  const [filled, setFilled] = useState(false);
  const [quote, setQuote] = useState<CartShippingQuote | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [seenReset, setSeenReset] = useState(resetKey);
  const fields = fieldErrors(error);
  const problems = addressProblems(error);

  // Adjusting state during render when its inputs change (React's documented pattern).
  if (!filled && last.data) {
    setFilled(true);
    setForm({ ...last.data, line2: last.data.line2 ?? '' });
  }
  if (resetKey !== seenReset) {
    setSeenReset(resetKey);
    setQuote(null);
  }

  const set = (key: keyof typeof EMPTY) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (quote) {
      setQuote(null);
      onChoose(null);
    }
  };

  function choose(next: CartShippingQuote, serviceToken: string) {
    setToken(serviceToken);
    const option = next.options.find((o) => o.serviceToken === serviceToken);
    onChoose(option ? { address: next.address, option } : null);
  }

  async function getOptions(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await cartApi.shippingOptions(lines, { ...form, line2: form.line2 || null });
      setQuote(next);
      choose(next, next.options[0]?.serviceToken ?? '');
    } catch (err) {
      setError(err);
      onChoose(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ship-heading">
      <h2 id="ship-heading">Shipping</h2>
      <form
        className={pageStyles.form}
        onSubmit={getOptions}
        aria-label="Shipping address"
        noValidate
      >
        {error ? (
          <div className={pageStyles.formError} role="alert">
            <p>{formMessage(error)}</p>
            {problems.length > 0 && (
              <ul>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
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
          error={fields['address.name']}
          maxLength={100}
          required
        />
        <FormField
          label="Street address"
          autoComplete="shipping address-line1"
          value={form.line1}
          onChange={(e) => set('line1')(e.target.value)}
          error={fields['address.line1']}
          maxLength={100}
          required
        />
        <FormField
          label="Apartment, suite, or unit (optional)"
          autoComplete="shipping address-line2"
          value={form.line2}
          onChange={(e) => set('line2')(e.target.value)}
          maxLength={100}
        />
        <FormField
          label="City"
          autoComplete="shipping address-level2"
          value={form.city}
          onChange={(e) => set('city')(e.target.value)}
          error={fields['address.city']}
          maxLength={60}
          required
        />
        <div className={pageStyles.field}>
          <label htmlFor="cart-state">State</label>
          <select
            id="cart-state"
            autoComplete="shipping address-level1"
            value={form.state}
            onChange={(e) => set('state')(e.target.value)}
            required
          >
            <option value="">Choose…</option>
            {US_STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <FormField
          label="ZIP code"
          autoComplete="shipping postal-code"
          inputMode="numeric"
          value={form.postalCode}
          onChange={(e) => set('postalCode')(e.target.value)}
          error={fields['address.postalCode']}
          maxLength={10}
          required
        />
        {!quote && (
          <button
            type="submit"
            className={`${buttonStyles.button} ${buttonStyles.secondary}`}
            disabled={busy}
          >
            {busy ? 'Checking the address…' : 'See shipping options'}
          </button>
        )}
        <p className={pageStyles.hint}>We ship within the United States only.</p>
      </form>

      {quote && (
        <fieldset className={pageStyles.fieldset}>
          <legend className={pageStyles.legend}>Choose shipping</legend>
          {quote.options.map((option) => (
            <label key={option.serviceToken} className={pageStyles.choice}>
              <input
                type="radio"
                name="cart-shipping"
                value={option.serviceToken}
                checked={token === option.serviceToken}
                onChange={() => choose(quote, option.serviceToken)}
              />
              <span>
                {option.carrier} {option.serviceName}
                {days(option)}: {usd(option.postageCents)} postage
                {option.packagingFeeCents > 0
                  ? ` + ${usd(option.packagingFeeCents)} packaging`
                  : ''}{' '}
                = <strong>{usd(option.totalCents)}</strong>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
}
