import { useSearchParams } from 'react-router';
import type { MonthlyReportRow } from '@shared/types/admin.ts';
import { monthlyReportCsvUrl } from '../../api/endpoints.ts';
import { useMonthlyReport } from '../../api/queries.ts';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import buttonStyles from '../../components/Button.module.css';
import { formatMoney } from '../../features/commissions/money.ts';
import { CURRENCY } from '../../features/admin/adminFormat.ts';
import styles from './Admin.module.css';

/** The first year the shop took payments; the year picker starts here. */
const FIRST_YEAR = 2026;

const money = (cents: number) => formatMoney(cents, CURRENCY);

/** "2026-03" → "March". */
function monthName(month: string): string {
  return new Date(`${month}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long' });
}

/**
 * The monthly report (ADR 0015): money in and out, and tree money, by month in New York
 * time, with a CSV download for bookkeeping.
 */
export function AdminReportPage() {
  const [params, setParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = Number(params.get('year')) || thisYear;
  const report = useMonthlyReport(year);
  const years = Array.from(
    { length: Math.max(1, thisYear - FIRST_YEAR + 1) },
    (_, i) => thisYear - i,
  );

  const rows = report.data ?? [];
  const sum = (pick: (row: MonthlyReportRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);

  return (
    <section className={styles.section} aria-labelledby="report-heading">
      <h2 id="report-heading">Monthly report</h2>
      <div className={styles.toolbar}>
        <label className={styles.label}>
          Year
          <select
            className={styles.select}
            value={year}
            onChange={(event) => setParams({ year: event.target.value }, { replace: true })}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <a
          href={monthlyReportCsvUrl(year)}
          download
          className={`${buttonStyles.button} ${buttonStyles.secondary}`}
        >
          Download CSV
        </a>
      </div>
      <p className={styles.muted}>
        Months are in New York time. Sales are deposits and final payments received; trees are
        counted when Digital Humani accepts them, and paid when you record their invoice.
      </p>

      {report.isPending && <Loading label="Loading the report" />}
      {report.isError && (
        <ErrorMessage message="The report couldn't load." onRetry={() => report.refetch()} />
      )}
      {report.data && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className={styles.number}>
                  Sales
                </th>
                <th scope="col" className={styles.number}>
                  Refunds
                </th>
                <th scope="col" className={styles.number}>
                  Net sales
                </th>
                <th scope="col" className={styles.number}>
                  Trees ordered
                </th>
                <th scope="col" className={styles.number}>
                  Donations paid
                </th>
                <th scope="col" className={styles.number}>
                  Owed at month end
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.month}>
                  <th scope="row">{monthName(row.month)}</th>
                  <td className={styles.number}>{money(row.salesCents)}</td>
                  <td className={styles.number}>{money(row.refundsCents)}</td>
                  <td className={styles.number}>{money(row.netSalesCents)}</td>
                  <td className={styles.number}>
                    {row.treesOrdered} ({money(row.treesOrderedCents)})
                  </td>
                  <td className={styles.number}>{money(row.donationsPaidCents)}</td>
                  <td className={styles.number}>{money(row.donationsOwedAtMonthEndCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{year} so far</td>
                <td className={styles.number}>{money(sum((r) => r.salesCents))}</td>
                <td className={styles.number}>{money(sum((r) => r.refundsCents))}</td>
                <td className={styles.number}>{money(sum((r) => r.netSalesCents))}</td>
                <td className={styles.number}>
                  {sum((r) => r.treesOrdered)} ({money(sum((r) => r.treesOrderedCents))})
                </td>
                <td className={styles.number}>{money(sum((r) => r.donationsPaidCents))}</td>
                <td className={styles.number}>
                  {money(rows.at(-1)?.donationsOwedAtMonthEndCents ?? 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
