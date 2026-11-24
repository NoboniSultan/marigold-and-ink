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
