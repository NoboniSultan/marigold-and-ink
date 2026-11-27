import { useId, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminOrder } from '@shared/types/order.ts';
import { ApiError, formMessage } from '../../api/client.ts';
import { adminOrdersApi } from '../../api/endpoints.ts';
import { queryKeys, useAdminOrder } from '../../api/queries.ts';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import buttonStyles from '../../components/Button.module.css';
import pageStyles from '../SimplePage.module.css';
import { formatDate } from '../../features/admin/adminFormat.ts';
import { ORDER_STATUS_TEXT } from '../../features/orders/orderFormat.ts';
import { usd } from '../../features/shop/shopFormat.ts';
import { NotFoundPage } from '../NotFoundPage.tsx';
import styles from './Admin.module.css';

function RefundForm({ order }: { order: AdminOrder }) {
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm(`Refund ${usd(order.subtotalCents)} for order #${order.id}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await adminOrdersApi.refund(order.id, { reason, restock });
      queryClient.setQueryData(queryKeys.adminOrder(order.id), updated);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-label="Refund" noValidate>
      <h3>Refund the order</h3>
      {error ? (
        <p className={styles.error} role="alert">
          {formMessage(error)}
        </p>
      ) : null}
      <div className={pageStyles.field}>
        <label htmlFor={reasonId}>Reason (kept with the order)</label>
        <textarea
          id={reasonId}
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
      </div>
      <label className={pageStyles.choice}>
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        <span>Put the items back on sale</span>
      </label>
      <button
        type="submit"
        className={`${buttonStyles.button} ${buttonStyles.primary}`}
        disabled={busy || !reason.trim()}
      >
        {busy ? 'Refunding…' : `Refund ${usd(order.subtotalCents)}`}
      </button>
    </form>
  );
}

/** One shop order: what was bought, by whom, its history, and refunds (milestone 12b). */
export function AdminOrderPage() {
  const id = Number(useParams().id);
  const { data: order, isPending, error, refetch } = useAdminOrder(id);

  if (isPending) return <Loading label="Loading order" />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error) return <ErrorMessage message="This order couldn't load." onRetry={() => refetch()} />;

  return (
    <>
      <Link to="/admin/orders">← All orders</Link>
      <section className={styles.section} aria-labelledby="order-heading">
        <h2 id="order-heading">Order #{order.id}</h2>
        <dl className={styles.facts}>
          <dt>Status</dt>
          <dd>{ORDER_STATUS_TEXT[order.status]}</dd>
          <dt>Client</dt>
          <dd>
            {order.client ? `${order.client.displayName} (${order.client.email})` : 'Deleted user'}
          </dd>
          <dt>Placed</dt>
          <dd>{formatDate(order.createdAt)}</dd>
          {order.paidAt && (
            <>
              <dt>Paid</dt>
              <dd>{formatDate(order.paidAt)}</dd>
            </>
          )}
        </dl>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className={styles.number}>
                  Quantity
                </th>
                <th scope="col" className={styles.number}>
                  Each
                </th>
                <th scope="col" className={styles.number}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.variantId}>
                  <td>
                    {item.productName} ({item.variantName})
                  </td>
                  <td className={styles.number}>{item.quantity}</td>
                  <td className={styles.number}>{usd(item.unitPriceCents)}</td>
                  <td className={styles.number}>{usd(item.lineCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td className={styles.number}>{usd(order.subtotalCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="history-heading">
        <h2 id="history-heading">History</h2>
        {order.events.length === 0 ? (
          <p className={styles.muted}>Waiting for payment since {formatDate(order.createdAt)}.</p>
        ) : (
          <ul>
            {order.events.map((e, i) => (
              <li key={i}>
                {formatDate(e.createdAt)}: {ORDER_STATUS_TEXT[e.toStatus]}
                {e.reason ? ` (${e.reason})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="refunds-heading">
        <h2 id="refunds-heading">Refunds</h2>
        {order.refunds.length > 0 && (
          <ul>
            {order.refunds.map((r) => (
              <li key={r.id}>
                {usd(r.amountCents)}, {r.status}, {formatDate(r.createdAt)}: {r.reason}
                {r.restock
                  ? r.restockedAt
                    ? ' (items back on sale)'
                    : ' (items go back on sale once it succeeds)'
                  : ''}
              </li>
            ))}
          </ul>
        )}
        {order.refundable ? (
          <RefundForm order={order} />
        ) : (
          order.refunds.length === 0 && (
            <p className={styles.muted}>Only a paid order can be refunded.</p>
          )
        )}
      </section>
    </>
  );
}
