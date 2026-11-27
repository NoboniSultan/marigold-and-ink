import { Link, useSearchParams } from 'react-router';
import type { OrderStatus } from '@shared/types/order.ts';
import { useAdminOrders } from '../../api/queries.ts';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import buttonStyles from '../../components/Button.module.css';
import { formatDate } from '../../features/admin/adminFormat.ts';
import { ORDER_STATUSES, ORDER_STATUS_TEXT } from '../../features/orders/orderFormat.ts';
import { usd } from '../../features/shop/shopFormat.ts';
import styles from './Admin.module.css';

const isStatus = (value: string | null): value is OrderStatus =>
  value !== null && (ORDER_STATUSES as string[]).includes(value);

/** Every shop order, newest first; filter by status. In the URL (?status, ?page). */
export function AdminOrdersPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status = isStatus(raw) ? raw : undefined;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const list = useAdminOrders({ status, page });
  const meta = list.data?.meta;
  const lastPage = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  function update(changes: Record<string, string | null>) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }

  return (
    <section className={styles.section} aria-labelledby="orders-heading">
      <h2 id="orders-heading">Shop orders</h2>
      <div className={styles.toolbar}>
        <label className={styles.label}>
          Status
          <select
            className={styles.select}
            value={status ?? ''}
            onChange={(e) => update({ status: e.target.value || null, page: null })}
          >
            <option value="">All</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_TEXT[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {list.isPending && <Loading label="Loading orders" />}
      {list.isError && (
        <ErrorMessage message="The orders couldn't load." onRetry={() => list.refetch()} />
      )}
      {list.data &&
        (list.data.data.length === 0 ? (
          <p>No orders{status ? ` with the status "${ORDER_STATUS_TEXT[status]}"` : ''} yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Client</th>
                  <th scope="col">Items</th>
                  <th scope="col">Status</th>
                  <th scope="col" className={styles.number}>
                    Total
                  </th>
                  <th scope="col">Placed</th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/admin/orders/${o.id}`}>#{o.id}</Link>
                    </td>
                    <td>{o.client?.displayName ?? 'Deleted user'}</td>
                    <td>{o.items.reduce((n, i) => n + i.quantity, 0)}</td>
                    <td>{ORDER_STATUS_TEXT[o.status]}</td>
                    <td className={styles.number}>{usd(o.subtotalCents)}</td>
                    <td>{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {meta && lastPage > 1 && (
        <div className={styles.pager}>
          <button
            type="button"
            className={`${buttonStyles.button} ${buttonStyles.secondary}`}
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) })}
          >
            Previous
          </button>
          <span>
            Page {page} of {lastPage}
          </span>
          <button
            type="button"
            className={`${buttonStyles.button} ${buttonStyles.secondary}`}
            disabled={page >= lastPage}
            onClick={() => update({ page: String(page + 1) })}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
