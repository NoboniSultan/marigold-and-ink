import { Link, useSearchParams } from 'react-router';
import { useAdminCommissions } from '../../api/queries.ts';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import buttonStyles from '../../components/Button.module.css';
import { formatMoney } from '../../features/commissions/money.ts';
import { CURRENCY, STATUSES, formatDate, statusLabel } from '../../features/admin/adminFormat.ts';
import styles from './Admin.module.css';

/** Every commission, newest first, with its client; filter by status. In the URL (?status, ?page). */
export function AdminCommissionsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const list = useAdminCommissions({ page, status: status || undefined });

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

  const meta = list.data?.meta;
  const lastPage = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <section className={styles.section} aria-labelledby="commissions-heading">
      <h2 id="commissions-heading">Commissions</h2>
      <div className={styles.toolbar}>
        <label className={styles.label}>
          Status
          <select
            className={styles.select}
            value={status}
            onChange={(event) => update({ status: event.target.value || null, page: null })}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {list.isPending && <Loading label="Loading commissions" />}
      {list.isError && (
        <ErrorMessage message="The commissions couldn't load." onRetry={() => list.refetch()} />
      )}
      {list.data &&
        (list.data.data.length === 0 ? (
          <p>No commissions{status ? ` with the status "${statusLabel(status)}"` : ''} yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Client</th>
                  <th scope="col">Piece</th>
                  <th scope="col">Status</th>
                  <th scope="col" className={styles.number}>
                    Total
                  </th>
                  <th scope="col">Requested</th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/commissions/${c.id}`}>#{c.id}</Link>
                    </td>
                    <td>
                      {c.client ? (
                        <>
                          {c.client.displayName}
                          <br />
                          <span className={styles.muted}>{c.client.email}</span>
                        </>
                      ) : (
                        <span className={styles.muted}>Deleted user</span>
                      )}
                    </td>
                    <td>
                      {c.size} {c.medium}
                      {c.isRush ? ', rush' : ''}
                    </td>
                    <td>{statusLabel(c.status)}</td>
                    <td className={styles.number}>
                      {c.quotedTotalCents === null
                        ? '–'
                        : formatMoney(c.quotedTotalCents, CURRENCY)}
                    </td>
                    <td>{formatDate(c.createdAt)}</td>
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
            onClick={() => update({ page: page - 1 > 1 ? String(page - 1) : null })}
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
