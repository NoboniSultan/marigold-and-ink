import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { CommissionDetails, CommissionStatus } from '@shared/types/commission.ts';
import type { Payment } from '@shared/types/payment.ts';
import { ApiError, formMessage } from '../api/client.ts';
import { paymentsApi } from '../api/endpoints.ts';
import { useCommission, usePayments } from '../api/queries.ts';
import { ErrorMessage, Loading } from '../components/Loading.tsx';
import buttonStyles from '../components/Button.module.css';
import { STATUS_TEXT } from '../features/commissions/statusText.ts';
import styles from './SimplePage.module.css';
import { formatMoney } from '../features/commissions/money.ts';

/** Leaving the site for Stripe's page. An object so tests can replace it. */
export const externalNavigation = {
  go(url: string) {
    window.location.assign(url);
  },
};

/** Which payment each status is waiting for. */
const DUE: Partial<Record<CommissionStatus, 'deposit' | 'final'>> = {
  quoted: 'deposit',
  awaiting_final_payment: 'final',
};

const PAYMENT_LABEL: Record<Payment['type'], string> = {
  deposit: 'Deposit',
  final: 'Balance',
  refund: 'Refund',
};

/** How long to keep checking for Stripe's confirmation after the client comes back. */
const CONFIRM_FOR_MS = 60_000;
const POLL_MS = 2_000;

// Kept importable from here for existing callers; it lives in features/commissions/money.ts.
export { formatMoney };

/** Money that actually moved: completed payments, and refunds that aren't failed. */
const shown = (p: Payment) =>
  p.type === 'refund' ? p.status !== 'failed' : p.status === 'succeeded';

function ReturnMessage({
  returned,
  confirmed,
  gaveUp,
}: {
  returned: string | null;
  confirmed: boolean;
  gaveUp: boolean;
}) {
  if (returned === 'cancelled') {
    return (
      <p className={styles.notice} role="status">
        Payment cancelled. Nothing was charged; you can pay whenever you&apos;re ready.
      </p>
    );
  }
  if (returned !== 'success') return null;
  if (confirmed) {
    return (
      <p className={styles.success} role="status">
        Thank you, your payment went through.
      </p>
    );
  }
  return gaveUp ? (
    <p className={styles.notice} role="status">
      Your payment is still being confirmed. This can take a minute; refresh this page shortly.
    </p>
  ) : (
    <p className={styles.notice} role="status">
      Thank you! Confirming your payment with Stripe…
    </p>
  );
}

function Details({
  commission,
  payments,
  currency,
}: {
  commission: CommissionDetails;
  payments: Payment[];
  currency: string | null;
}) {
  const money = (cents: number) => formatMoney(cents, currency);
  return (
    <>
      <dl className={styles.facts}>
        <dt>Size</dt>
        <dd>{commission.size}</dd>
        <dt>Medium</dt>
        <dd>{commission.medium}</dd>
        <dt>Subjects</dt>
        <dd>{commission.subjectCount}</dd>
        <dt>Delivery</dt>
        <dd>{commission.fulfillmentType.replace('_', ' ')}</dd>
        {commission.isRush && (
          <>
            <dt>Rush</dt>
            <dd>Yes</dd>
          </>
        )}
        {commission.quotedTotalCents !== null && (
          <>
            <dt>Total</dt>
            <dd>{money(commission.quotedTotalCents)}</dd>
            <dt>Deposit</dt>
            <dd>{money(commission.depositCents ?? 0)}</dd>
            <dt>Balance</dt>
            <dd>{money(commission.balanceCents ?? 0)}</dd>
          </>
        )}
      </dl>

      {payments.length > 0 && (
        <>
          <h2>Payments</h2>
          <ul className={styles.list}>
            {payments.map((p) => (
              <li key={p.id}>
                {PAYMENT_LABEL[p.type]}: {money(p.amountCents)} on{' '}
                {new Date(p.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}
                {p.status === 'pending' ? ' (processing)' : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function CommissionStatus({ id }: { id: number }) {
  const [params] = useSearchParams();
  const returned = params.get('payment');
  // Back from Stripe, Stripe's confirmation (the webhook) may arrive a moment later, so the
  // page checks again every few seconds until the status moves on, for at most a minute.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (returned !== 'success') return;
    const timer = setTimeout(() => setGaveUp(true), CONFIRM_FOR_MS);
    return () => clearTimeout(timer);
  }, [returned]);

  const [stillWaiting, setStillWaiting] = useState(returned === 'success');
  const poll = stillWaiting && !gaveUp ? POLL_MS : false;
  const commission = useCommission(id, { pollMs: poll });
  const payments = usePayments(id, { pollMs: poll });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const due = commission.data ? DUE[commission.data.status] : undefined;
  // Confirmed once the status has moved past the payment it was waiting for.
  const confirmed = returned === 'success' && commission.data !== undefined && !due;
  // Adjusting state during render when derived data changes (React's documented pattern).
  if (stillWaiting && confirmed) setStillWaiting(false);

  if (commission.isPending || payments.isPending) return <Loading label="Loading your request" />;
  if (commission.isError) {
    const missing =
      commission.error instanceof ApiError && [403, 404].includes(commission.error.status);
    return missing ? (
      <p>
        We couldn&apos;t find this request. <Link to="/commission">Make a new request</Link>.
      </p>
    ) : (
      <ErrorMessage message="Your request couldn't load." onRetry={() => commission.refetch()} />
    );
  }
  if (payments.isError) {
    return (
      <ErrorMessage message="Your payments couldn't load." onRetry={() => payments.refetch()} />
    );
  }

  const { data: list, meta } = payments.data;
  const amountDue =
    due === 'deposit' ? commission.data.depositCents : due ? commission.data.balanceCents : null;

  async function pay(type: 'deposit' | 'final') {
    setStarting(true);
    setError(null);
    try {
      const { url } = await paymentsApi.start(id, type);
      externalNavigation.go(url); // stays "starting" while the browser leaves
    } catch (err) {
      setError(err);
      setStarting(false);
    }
  }

  return (
    <>
      <ReturnMessage returned={returned} confirmed={confirmed} gaveUp={gaveUp} />
      <p>
        <strong>{STATUS_TEXT[commission.data.status]}</strong>
      </p>

      {due && amountDue ? (
        meta.paymentsEnabled ? (
          <div className={styles.form}>
            {error ? (
              <p className={styles.formError} role="alert">
                {formMessage(error)}
              </p>
            ) : null}
            <button
              type="button"
              className={`${buttonStyles.button} ${buttonStyles.primary}`}
              onClick={() => pay(due)}
              disabled={starting}
            >
              {starting
                ? 'Opening the secure payment page…'
                : `Pay ${due === 'deposit' ? 'deposit' : 'balance'} (${formatMoney(amountDue, meta.currency)})`}
            </button>
            <p className={styles.hint}>
              You&apos;ll pay on Stripe&apos;s secure page, then come back here.
            </p>
          </div>
        ) : (
          <p className={styles.notice}>Online payment opens soon.</p>
        )
      ) : null}

      <Details
        commission={commission.data}
        payments={list.filter(shown)}
        currency={meta.currency}
      />
    </>
  );
}

/** A client's own commission: status, price, payments, and the next payment if one is due. */
export function CommissionStatusPage() {
  const id = Number(useParams().id);
  const valid = Number.isSafeInteger(id) && id > 0;

  return (
    <section className={`${styles.page} ${styles.wide}`}>
      <h1>{valid ? `Request #${id}` : 'Request'}</h1>
      {valid ? (
        <CommissionStatus id={id} />
      ) : (
        <p>
          We couldn&apos;t find this request. <Link to="/commission">Make a new request</Link>.
        </p>
      )}
    </section>
  );
}
