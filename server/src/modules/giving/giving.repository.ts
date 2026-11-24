/**
 * SQL for the donations ledger's tree rows and the active charity. Every function accepts
 * an optional `client` so the service can run several calls in one transaction.
 */
import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

type Db = Pool | PoolClient;

export interface TreeDonation {
  id: number;
  commissionId: number;
  treeCount: number;
  status: 'pending' | 'owed' | 'paid' | 'reversed';
  requestAttemptedAt: Date | null;
}

export async function findActiveCharityId(client: Db = pool): Promise<number | null> {
  const { rows } = await client.query('SELECT id FROM charities WHERE is_active');
  return rows[0]?.id ?? null;
}

/** Returns the new row's ID, or null if this payment already has a donation (a replay). */
export async function insertTreeDonation(
  donation: {
    paymentId: number;
    commissionId: number;
    charityId: number;
    percentage: number;
    baseAmountCents: number;
    donationAmountCents: number;
    treeCount: number;
  },
  client: Db = pool,
): Promise<number | null> {
  const { rows } = await client.query(
    `INSERT INTO donations (payment_id, commission_id, charity_id, percentage,
                            base_amount_cents, donation_amount_cents, tree_count, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     ON CONFLICT ON CONSTRAINT donations_payment_id_key DO NOTHING
     RETURNING id`,
    [
      donation.paymentId,
      donation.commissionId,
      donation.charityId,
      donation.percentage,
      donation.baseAmountCents,
      donation.donationAmountCents,
      donation.treeCount,
    ],
  );
  return rows[0]?.id ?? null;
}

/** The commission's tree money: requested or about to be, so it can't be refunded. */
export async function withheldForTreesCents(commissionId: number, client: Db = pool) {
  const { rows } = await client.query(
    `SELECT coalesce(sum(donation_amount_cents), 0)::int AS cents FROM donations
      WHERE commission_id = $1 AND tree_count IS NOT NULL AND status <> 'reversed'`,
    [commissionId],
  );
  return rows[0].cents as number;
}

/** Tree requests that haven't gone through, oldest first. */
export async function listPendingTreeDonationIds(client: Db = pool): Promise<number[]> {
  const { rows } = await client.query(
    `SELECT id FROM donations WHERE status = 'pending' AND tree_count IS NOT NULL ORDER BY id`,
  );
  return rows.map((row) => row.id as number);
}

/**
 * Claims a pending row for one request attempt: locks it (skipping a row another worker
 * holds), and only if it wasn't attempted in the last `staleAfterMinutes` (an attempt may
 * still be in flight). Stamps the attempt and returns the row as it was before.
 */
export async function claimForRequest(
  id: number,
  staleAfterMinutes: number,
  client: Db = pool,
): Promise<TreeDonation | null> {
  const { rows } = await client.query(
    `SELECT id, commission_id, tree_count, status, request_attempted_at FROM donations
      WHERE id = $1 AND status = 'pending' AND tree_count IS NOT NULL
        AND (request_attempted_at IS NULL
             OR request_attempted_at < now() - make_interval(mins => $2))
      FOR UPDATE SKIP LOCKED`,
    [id, staleAfterMinutes],
  );
  const row = rows[0];
  if (!row) return null;
  await client.query('UPDATE donations SET request_attempted_at = now() WHERE id = $1', [id]);
  return {
    id: row.id,
    commissionId: row.commission_id,
    treeCount: row.tree_count,
    status: row.status,
    requestAttemptedAt: row.request_attempted_at,
  };
}

/**
 * The trees are on order. `requestId` is Digital Humani's ID for the request, or null when
 * a retry found the trees already counted under the commission's reference (the API can
 * count a reference's trees but not list its requests, so there's no ID to record).
 */
export async function markRequested(id: number, requestId: string | null, client: Db = pool) {
  await client.query(
    `UPDATE donations SET status = 'owed', tree_request_id = $2, requested_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [id, requestId],
  );
}

/** For the Giving page: trees funded by fully paid commissions (requested or about to be). */
export async function treesFunded(client: Db = pool): Promise<number> {
  const { rows } = await client.query(
    `SELECT coalesce(sum(tree_count), 0)::int AS trees FROM donations
      WHERE tree_count IS NOT NULL AND status <> 'reversed'`,
  );
  return rows[0].trees as number;
}

/**
 * Makes `name` the active charity, creating it if needed, unless another charity is already
 * active (the owner may have chosen one since). Returns what happened.
 */
export async function ensureActiveCharity(
  { name, description, websiteUrl }: { name: string; description: string; websiteUrl: string },
  client: Db = pool,
): Promise<'created' | 'activated' | 'unchanged'> {
  if ((await findActiveCharityId(client)) !== null) return 'unchanged';
  const { rows } = await client.query(
    `INSERT INTO charities (name, description, website_url, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT ON CONSTRAINT charities_name_key DO UPDATE SET is_active = true
     RETURNING (xmax = 0) AS created`,
    [name, description, websiteUrl],
  );
  return rows[0].created ? 'created' : 'activated';
}

// --- The admin screens (milestone 9) ---

export interface DonationRecord {
  id: number;
  commissionId: number;
  treeCount: number | null;
  amountCents: number;
  status: 'pending' | 'owed' | 'paid' | 'reversed';
  requestedAt: Date | null;
  treeRequestId: string | null;
  /** YYYY-MM-DD (a date column, read as text so no time zone can shift it). */
  payoutDate: string | null;
  receiptReference: string | null;
  createdAt: Date;
}

const DONATION_COLUMNS = `id, commission_id, tree_count, donation_amount_cents, status,
  requested_at, tree_request_id, payout_date::text AS payout_date, receipt_reference, created_at`;

function toDonation(row: Record<string, unknown>): DonationRecord {
  return {
    id: Number(row.id),
    commissionId: Number(row.commission_id),
    treeCount: row.tree_count === null ? null : Number(row.tree_count),
    amountCents: Number(row.donation_amount_cents),
    status: row.status as DonationRecord['status'],
    requestedAt: row.requested_at as Date | null,
    treeRequestId: row.tree_request_id as string | null,
    payoutDate: row.payout_date as string | null,
    receiptReference: row.receipt_reference as string | null,
    createdAt: row.created_at as Date,
  };
}

/** Donations, newest first, optionally by status, with the total for paging. */
export async function listDonations(
  {
    status,
    limit,
    offset,
  }: { status: DonationRecord['status'] | undefined; limit: number; offset: number },
  client: Db = pool,
): Promise<{ donations: DonationRecord[]; total: number }> {
  const { rows } = await client.query(
    `SELECT ${DONATION_COLUMNS}, count(*) OVER () AS total FROM donations
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [status ?? null, limit, offset],
  );
  if (rows.length > 0) return { donations: rows.map(toDonation), total: Number(rows[0].total) };
  const { rows: counted } = await client.query(
    'SELECT count(*)::int AS total FROM donations WHERE ($1::text IS NULL OR status = $1)',
    [status ?? null],
  );
  return { donations: [], total: counted[0].total };
}

/** Locks the given donations (for marking paid), in ID order so two batches can't deadlock. */
export async function lockDonations(ids: number[], client: Db): Promise<DonationRecord[]> {
  const { rows } = await client.query(
    `SELECT ${DONATION_COLUMNS} FROM donations WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
    [ids],
  );
  return rows.map(toDonation);
}

/** Owed → paid, with the day the invoice was paid and its receipt. */
export async function markPaid(
  ids: number[],
  { payoutDate, receiptReference }: { payoutDate: string; receiptReference: string },
  client: Db,
): Promise<DonationRecord[]> {
  const { rows } = await client.query(
    `UPDATE donations SET status = 'paid', payout_date = $2, receipt_reference = $3
      WHERE id = ANY($1::bigint[]) AND status = 'owed'
      RETURNING ${DONATION_COLUMNS}`,
    [ids, payoutDate, receiptReference],
  );
  return rows.map(toDonation).sort((a, b) => a.id - b.id);
}

/** A commission's tree donation (there's at most one: its final payment's). */
export async function treeDonationForCommission(
  commissionId: number,
  client: Db = pool,
): Promise<DonationRecord | null> {
  const { rows } = await client.query(
    `SELECT ${DONATION_COLUMNS} FROM donations
      WHERE commission_id = $1 AND tree_count IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    [commissionId],
  );
  return rows[0] ? toDonation(rows[0]) : null;
}

export interface MonthlyGiving {
  month: string;
  treesOrdered: number;
  treesOrderedCents: number;
  donationsPaidCents: number;
  donationsOwedAtMonthEndCents: number;
}

/**
 * Each month of `year`, in `timeZone` (ADR 0015):
 * - trees ordered: tree donations Digital Humani accepted that month (by requested_at);
 * - paid: donations whose invoice was paid that month (by payout_date);
 * - owed at month end: tree money requested by the end of the month and not yet paid then.
 */
export async function monthlyGiving(
  year: number,
  timeZone: string,
  client: Db = pool,
): Promise<MonthlyGiving[]> {
  const { rows } = await client.query(
    `WITH months AS (
       SELECT m::date AS starts, (m + interval '1 month')::date AS ends
         FROM generate_series(make_date($1, 1, 1), make_date($1, 12, 1), interval '1 month') AS m
     ),
     trees AS (
       SELECT (requested_at AT TIME ZONE $2)::date AS requested_on, tree_count,
              donation_amount_cents, payout_date
         FROM donations
        WHERE tree_count IS NOT NULL AND requested_at IS NOT NULL
          AND status IN ('owed', 'paid')
     )
     SELECT to_char(months.starts, 'YYYY-MM') AS month,
       coalesce((SELECT sum(tree_count) FROM trees
                  WHERE requested_on >= months.starts AND requested_on < months.ends), 0)::int
         AS trees_ordered,
       coalesce((SELECT sum(donation_amount_cents) FROM trees
                  WHERE requested_on >= months.starts AND requested_on < months.ends), 0)::int
         AS trees_ordered_cents,
       coalesce((SELECT sum(donation_amount_cents) FROM donations
                  WHERE status = 'paid' AND payout_date >= months.starts
                    AND payout_date < months.ends), 0)::int AS paid_cents,
       coalesce((SELECT sum(donation_amount_cents) FROM trees
                  WHERE requested_on < months.ends
                    AND (payout_date IS NULL OR payout_date >= months.ends)), 0)::int
         AS owed_cents
       FROM months ORDER BY months.starts`,
    [year, timeZone],
  );
  return rows.map((row) => ({
    month: row.month,
    treesOrdered: row.trees_ordered,
    treesOrderedCents: row.trees_ordered_cents,
    donationsPaidCents: row.paid_cents,
    donationsOwedAtMonthEndCents: row.owed_cents,
  }));
}
