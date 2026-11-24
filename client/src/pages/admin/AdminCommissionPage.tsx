import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminCommissionDetails, Quote } from '@shared/types/admin.ts';
import type { CommissionStatus } from '@shared/types/commission.ts';
import { fieldErrors, formMessage } from '../../api/client.ts';
import { adminApi } from '../../api/endpoints.ts';
import { queryKeys, useAdminCommission, useAdminQuote, usePayments } from '../../api/queries.ts';
import { FormField } from '../../components/FormField.tsx';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import buttonStyles from '../../components/Button.module.css';
import { formatMoney } from '../../features/commissions/money.ts';
import {
  CURRENCY,
  dollarsToCents,
  formatDate,
  statusLabel,
} from '../../features/admin/adminFormat.ts';
import styles from './Admin.module.css';

const money = (cents: number) => formatMoney(cents, CURRENCY);

/** After any change, refresh every admin view and the commission's own caches. */
function useRefresh(id: number) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin }),
      queryClient.invalidateQueries({ queryKey: queryKeys.payments(id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.commission(id) }),
    ]);
}

/** One commission for the admin: details, quote, status moves, and money (with refunds). */
export function AdminCommissionPage() {
  const id = Number(useParams().id);
  const details = useAdminCommission(id);

  if (details.isPending) return <Loading label="Loading the commission" />;
  if (details.isError) {
    return (
      <ErrorMessage message="This commission couldn't load." onRetry={() => details.refetch()} />
    );
  }
  const { commission, client } = details.data;

  return (
    <>
      <p>
        <Link to="/admin/commissions">← All commissions</Link>
      </p>
      <section className={styles.section} aria-labelledby="request-heading">
        <h2 id="request-heading">
          Request #{commission.id}: {statusLabel(commission.status)}
        </h2>
        <dl className={styles.facts}>
          <dt>Client</dt>
          <dd>
            {client ? (
              <>
                {client.displayName} (<a href={`mailto:${client.email}`}>{client.email}</a>)
              </>
            ) : (
              'Deleted user'
            )}
          </dd>
          <dt>Piece</dt>
          <dd>
            {commission.size} {commission.medium}, {commission.subjectCount}{' '}
            {commission.subjectCount === 1 ? 'subject' : 'subjects'}
          </dd>
          <dt>Fulfillment</dt>
          <dd>
            {statusLabel(commission.fulfillmentType)}
            {commission.isRush ? ', rush' : ''}
          </dd>
          <dt>Notes</dt>
          <dd>{commission.notes ?? '–'}</dd>
          <dt>Requested</dt>
          <dd>{formatDate(commission.createdAt)}</dd>
          <dt>Revisions</dt>
          <dd>
            {commission.revisionCount} of {commission.revisionLimit}
          </dd>
        </dl>
      </section>
      <QuoteSection id={id} status={commission.status} />
      <StatusSection details={details.data} />
      <MoneySection details={details.data} />
    </>
  );
}

function QuoteSection({ id, status }: { id: number; status: CommissionStatus }) {
  const quote = useAdminQuote(id);
  const refresh = useRefresh(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const canGenerate = status === 'inquiry';
  return (
    <section className={styles.section} aria-labelledby="quote-heading">
      <h2 id="quote-heading">Quote</h2>
      {error ? (
        <p className={styles.error} role="alert">
          {formMessage(error)}
        </p>
      ) : null}
      {quote.isPending && <Loading label="Loading the quote" />}
      {quote.isError && (
        <ErrorMessage message="The quote couldn't load." onRetry={() => quote.refetch()} />
      )}
      {quote.data === null && (
        <>
          <p>No quote yet.</p>
          {canGenerate && (
            <div className={styles.actions}>
              <button
                type="button"
                className={`${buttonStyles.button} ${buttonStyles.primary}`}
                disabled={busy}
                onClick={() => run(() => adminApi.generateQuote(id))}
              >
                Generate quote
              </button>
            </div>
          )}
        </>
      )}
      {quote.data && (
        <>
          <QuoteTable quote={quote.data} />
          {quote.data.status === 'draft' ? (
            <>
              <p className={styles.muted}>Draft: the client can't see it until it's sent.</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${buttonStyles.button} ${buttonStyles.primary}`}
                  disabled={busy}
                  onClick={() => run(() => adminApi.sendQuote(id))}
                >
                  Send quote to the client
                </button>
                {canGenerate && (
                  <button
                    type="button"
                    className={`${buttonStyles.button} ${buttonStyles.secondary}`}
                    disabled={busy}
                    onClick={() => run(() => adminApi.generateQuote(id))}
                  >
                    Generate again from current prices
                  </button>
                )}
              </div>
              <AdjustForm id={id} quote={quote.data} onDone={refresh} />
            </>
          ) : (
            <p className={styles.muted}>
              {statusLabel(quote.data.status)}
              {quote.data.sentAt ? ` on ${formatDate(quote.data.sentAt)}` : ''}. A sent quote can't
              change.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function QuoteTable({ quote }: { quote: Quote }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className={styles.number}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {quote.lineItems.map((item, i) => (
            <tr key={i}>
              <td>
                {item.label}
                {item.quantity > 1 ? ` × ${item.quantity}` : ''}
              </td>
              <td className={styles.number}>{money(item.amountCents)}</td>
            </tr>
          ))}
          {quote.adjustedAmountCents !== null && (
            <tr>
              <td>
                Adjusted from {money(quote.computedAmountCents)}: {quote.adjustmentNote}
              </td>
              <td className={styles.number}>{money(quote.adjustedAmountCents)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td>
              Total (deposit {money(quote.depositCents)}, balance {money(quote.balanceCents)})
            </td>
            <td className={styles.number}>{money(quote.totalCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function AdjustForm({
  id,
  quote,
  onDone,
}: {
  id: number;
  quote: Quote;
  onDone: () => Promise<unknown>;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState(quote.adjustmentNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [amountError, setAmountError] = useState<string | undefined>();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const cents = dollarsToCents(amount);
    setAmountError(cents === null ? 'Enter an amount in dollars, like 125 or 125.50' : undefined);
    if (cents === null) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.adjustQuote(id, { adjustedAmountCents: cents, adjustmentNote: note });
      setAmount('');
      await onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fields = fieldErrors(error);
  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate aria-label="Adjust the price">
      {error ? (
        <p className={styles.error} role="alert">
          {formMessage(error)}
        </p>
      ) : null}
      <FormField
        label="New total (USD)"
        name="adjustedAmount"
        inputMode="decimal"
        required
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        error={amountError ?? fields.adjustedAmountCents}
        hint={`Pricing rules give ${money(quote.computedAmountCents)}.`}
      />
      <FormField
        label="Reason (the client sees it)"
        name="adjustmentNote"
        required
        maxLength={500}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        error={fields.adjustmentNote}
      />
      <div>
        <button
          type="submit"
          className={`${buttonStyles.button} ${buttonStyles.secondary}`}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Adjust price'}
        </button>
      </div>
    </form>
  );
}

function StatusSection({ details }: { details: AdminCommissionDetails }) {
  const { commission } = details;
  const refresh = useRefresh(commission.id);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function move(toStatus: CommissionStatus) {
    if (
      toStatus === 'canceled' &&
      !window.confirm(`Cancel request #${commission.id}? This can't be undone.`)
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.transition(commission.id, {
        toStatus,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setReason('');
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const moves = commission.availableTransitions;
  return (
    <section className={styles.section} aria-labelledby="status-heading">
      <h2 id="status-heading">Status</h2>
      {error ? (
        <p className={styles.error} role="alert">
          {formMessage(error)}
        </p>
      ) : null}
      {moves.length === 0 ? (
        <p className={styles.muted}>
          {commission.status === 'inquiry'
            ? 'Send a quote to move this request on.'
            : 'Nothing to do here right now: the next step is the client’s, or a payment.'}
        </p>
      ) : (
        <>
          <FormField
            label="Note for the history (optional)"
            name="reason"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className={styles.actions}>
            {moves.map((to) => (
              <button
                key={to}
                type="button"
                className={`${buttonStyles.button} ${
                  to === 'canceled' ? buttonStyles.secondary : buttonStyles.primary
                }`}
                disabled={busy}
                onClick={() => move(to)}
              >
                {to === 'canceled' ? 'Cancel commission' : `Move to: ${statusLabel(to)}`}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function MoneySection({ details }: { details: AdminCommissionDetails }) {
  const { commission, money: summary } = details;
  const payments = usePayments(commission.id);
  const refresh = useRefresh(commission.id);
  const [paymentId, setPaymentId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [amountError, setAmountError] = useState<string | undefined>();
  const [done, setDone] = useState<string | null>(null);

  const refundable = (payments.data?.data ?? []).filter(
    (p) => p.type !== 'refund' && p.status === 'succeeded',
  );

  async function onRefund(event: FormEvent) {
    event.preventDefault();
    const cents = amount.trim() ? dollarsToCents(amount) : undefined;
    setAmountError(cents === null ? 'Enter an amount in dollars, or leave it empty' : undefined);
    if (cents === null) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const refund = await adminApi.refund(commission.id, {
        paymentId: Number(paymentId || refundable[0]?.id),
        ...(cents !== undefined ? { amountCents: cents } : {}),
        reason,
      });
      setDone(`Refund of ${money(refund.amountCents)} started. Stripe takes a few days.`);
      setAmount('');
      setReason('');
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="money-heading">
      <h2 id="money-heading">Money</h2>
      <dl className={styles.facts}>
        <dt>Paid</dt>
        <dd>{money(summary.paidCents)}</dd>
        <dt>Refunded</dt>
        <dd>{money(summary.refundedCents)}</dd>
        <dt>Went to trees</dt>
        <dd>
          {money(summary.withheldForTreesCents)}
          {summary.trees
            ? ` (${summary.trees.count} trees, ${summary.trees.status})`
            : ' (none yet: trees are ordered with the final payment)'}
        </dd>
        <dt>Can still be refunded</dt>
        <dd>{money(summary.refundableCents)}</dd>
      </dl>
      {summary.treeMoneyRefundedCents > 0 && (
        <p className={styles.warning} role="alert">
          A refund made in the Stripe Dashboard gave back {money(summary.treeMoneyRefundedCents)} of
          tree money. Those trees are on order, and their invoice is still owed. Refund only from
          this page to keep the tree money.
        </p>
      )}

      {payments.isPending && <Loading label="Loading payments" />}
      {payments.isError && (
        <ErrorMessage message="The payments couldn't load." onRetry={() => payments.refetch()} />
      )}
      {payments.data && payments.data.data.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.number}>
                  Amount
                </th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {payments.data.data.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.createdAt)}</td>
                  <td>{statusLabel(p.type)}</td>
                  <td>{statusLabel(p.status)}</td>
                  <td className={styles.number}>
                    {p.type === 'refund' ? '−' : ''}
                    {money(p.amountCents)}
                  </td>
                  <td>{p.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.refundableCents > 0 && refundable.length > 0 && (
        <form className={styles.form} onSubmit={onRefund} noValidate aria-label="Refund">
          <h3>Refund</h3>
          {error ? (
            <p className={styles.error} role="alert">
              {formMessage(error)}
            </p>
          ) : null}
          {done && (
            <p className={styles.status} role="status">
              {done}
            </p>
          )}
          <label className={styles.label}>
            Payment
            <select
              className={styles.select}
              value={paymentId || String(refundable[0]!.id)}
              onChange={(event) => setPaymentId(event.target.value)}
            >
              {refundable.map((p) => (
                <option key={p.id} value={p.id}>
                  {statusLabel(p.type)}, {money(p.amountCents)}, {formatDate(p.createdAt)}
                </option>
              ))}
            </select>
          </label>
          <FormField
            label="Amount (USD)"
            name="refundAmount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            hint="Leave empty to refund everything that can be (tree money is always kept)."
            error={amountError ?? fieldErrors(error).amountCents}
          />
          <FormField
            label="Reason"
            name="refundReason"
            required
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={fieldErrors(error).reason}
          />
          <div>
            <button
              type="submit"
              className={`${buttonStyles.button} ${buttonStyles.secondary}`}
              disabled={busy}
            >
              {busy ? 'Refunding…' : 'Refund'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
