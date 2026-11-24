import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { DonationStatus } from '@shared/types/admin.ts';
import { fieldErrors, formMessage } from '../../api/client.ts';
import { adminApi } from '../../api/endpoints.ts';
import { queryKeys, useAdminDonations } from '../../api/queries.ts';
import { FormField } from '../../components/FormField.tsx';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import buttonStyles from '../../components/Button.module.css';
import { formatMoney } from '../../features/commissions/money.ts';
import { CURRENCY, formatDate } from '../../features/admin/adminFormat.ts';
import styles from './Admin.module.css';

const VIEWS: { status: DonationStatus; label: string }[] = [
  { status: 'owed', label: 'Owed' },
  { status: 'paid', label: 'Paid' },
  { status: 'pending', label: 'Waiting for Digital Humani' },
];

/** Today in the browser's time zone, for the payout date's default. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Tree donations (ADR 0013). When the planting partner's invoice arrives (it usually
 * covers several commissions), tick its donations and record the day it was paid and the
 * receipt number, all at once.
 */
export function AdminGivingPage() {
  const [params, setParams] = useSearchParams();
  const status = (VIEWS.find((v) => v.status === params.get('status'))?.status ??
    'owed') as DonationStatus;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const donations = useAdminDonations({ status, page });
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<number[]>([]);
  const [payoutDate, setPayoutDate] = useState(today());
  const [receipt, setReceipt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  const rows = donations.data?.data ?? [];
  const selectedRows = rows.filter((d) => selected.includes(d.id));
  const selectedCents = selectedRows.reduce((sum, d) => sum + d.amountCents, 0);
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  function show(next: DonationStatus) {
    setSelected([]);
    setDone(null);
    setError(null);
    setParams(next === 'owed' ? {} : { status: next }, { replace: true });
  }

  function toggle(id: number) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  async function onMarkPaid(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const paid = await adminApi.markDonationsPaid({
        donationIds: selectedRows.map((d) => d.id),
        payoutDate,
        receiptReference: receipt,
      });
      const cents = paid.reduce((sum, d) => sum + d.amountCents, 0);
      setDone(
        `Marked ${paid.length} ${paid.length === 1 ? 'donation' : 'donations'} paid (${formatMoney(cents, CURRENCY)}).`,
      );
      setSelected([]);
      setReceipt('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const meta = donations.data?.meta;
  const lastPage = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;
  const fields = fieldErrors(error);

  return (
    <section className={styles.section} aria-labelledby="giving-heading">
      <h2 id="giving-heading">Giving: trees</h2>
      <div className={styles.actions} role="group" aria-label="Show">
        {VIEWS.map((view) => (
          <button
            key={view.status}
            type="button"
            aria-pressed={view.status === status}
            className={`${buttonStyles.button} ${
              view.status === status ? buttonStyles.primary : buttonStyles.secondary
            }`}
            onClick={() => show(view.status)}
          >
            {view.label}
          </button>
        ))}
      </div>
      {done && (
        <p className={styles.status} role="status">
          {done}
        </p>
      )}

      {donations.isPending && <Loading label="Loading donations" />}
      {donations.isError && (
        <ErrorMessage message="The donations couldn't load." onRetry={() => donations.refetch()} />
      )}
      {donations.data &&
        (rows.length === 0 ? (
          <p>Nothing {VIEWS.find((v) => v.status === status)!.label.toLowerCase()} right now.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {status === 'owed' && (
                    <th scope="col">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? [] : rows.map((d) => d.id))}
                      />
                    </th>
                  )}
                  <th scope="col">Request</th>
                  <th scope="col" className={styles.number}>
                    Trees
                  </th>
                  <th scope="col" className={styles.number}>
                    Amount
                  </th>
                  <th scope="col">Ordered</th>
                  {status === 'paid' && <th scope="col">Paid</th>}
                  {status === 'paid' && <th scope="col">Receipt</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    {status === 'owed' && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select request #${d.commissionId}`}
                          checked={selected.includes(d.id)}
                          onChange={() => toggle(d.id)}
                        />
                      </td>
                    )}
                    <td>
                      <Link to={`/admin/commissions/${d.commissionId}`}>#{d.commissionId}</Link>
                    </td>
                    <td className={styles.number}>{d.treeCount ?? '–'}</td>
                    <td className={styles.number}>{formatMoney(d.amountCents, CURRENCY)}</td>
                    <td>{formatDate(d.requestedAt)}</td>
                    {status === 'paid' && <td>{formatDate(d.payoutDate)}</td>}
                    {status === 'paid' && <td>{d.receiptReference}</td>}
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
            onClick={() =>
              setParams({ ...(status === 'owed' ? {} : { status }), page: String(page - 1) })
            }
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
            onClick={() =>
              setParams({ ...(status === 'owed' ? {} : { status }), page: String(page + 1) })
            }
          >
            Next
          </button>
        </div>
      )}

      {status === 'owed' && rows.length > 0 && (
        <form className={styles.form} onSubmit={onMarkPaid} noValidate aria-label="Mark paid">
          <h3>Record a paid invoice</h3>
          {error ? (
            <p className={styles.error} role="alert">
              {formMessage(error)}
            </p>
          ) : null}
          <FormField
            label="Paid on"
            name="payoutDate"
            type="date"
            required
            max={today()}
            value={payoutDate}
            onChange={(event) => setPayoutDate(event.target.value)}
            error={fields.payoutDate}
          />
          <FormField
            label="Receipt or invoice number"
            name="receiptReference"
            required
            maxLength={200}
            value={receipt}
            onChange={(event) => setReceipt(event.target.value)}
            error={fields.receiptReference}
          />
          <div>
            <button
              type="submit"
              className={`${buttonStyles.button} ${buttonStyles.primary}`}
              disabled={busy || selectedRows.length === 0}
            >
              {selectedRows.length === 0
                ? 'Select the donations this invoice covers'
                : `Mark ${selectedRows.length} paid (${formatMoney(selectedCents, CURRENCY)})`}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
