import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

type Db = Pool | PoolClient;
type Row = Record<string, unknown>;

export type PaymentType = 'deposit' | 'final' | 'refund';
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'expired';

export interface PaymentRecord {
  id: number;
  commissionId: number;
  type: PaymentType;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeRefundId: string | null;
  refundedPaymentId: number | null;
  checkoutUrl: string | null;
  checkoutExpiresAt: Date | null;
  reason: string | null;
  requestedByUserId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS = `id, commission_id, type, amount_cents, currency, status,
  stripe_checkout_session_id, stripe_payment_intent_id, stripe_refund_id, refunded_payment_id,
  checkout_url, checkout_expires_at, reason, requested_by_user_id, created_at, updated_at`;

// bigint columns arrive as strings from pg; IDs here stay far below 2^53.
const toId = (value: unknown) => (value === null ? null : Number(value));

function toPayment(row: Row): PaymentRecord {
  return {
    id: Number(row.id),
    commissionId: Number(row.commission_id),
    type: row.type as PaymentType,
    amountCents: row.amount_cents as number,
    currency: row.currency as string,
    status: row.status as PaymentStatus,
    stripeCheckoutSessionId: row.stripe_checkout_session_id as string | null,
    stripePaymentIntentId: row.stripe_payment_intent_id as string | null,
    stripeRefundId: row.stripe_refund_id as string | null,
    refundedPaymentId: toId(row.refunded_payment_id),
    checkoutUrl: row.checkout_url as string | null,
    checkoutExpiresAt: row.checkout_expires_at as Date | null,
    reason: row.reason as string | null,
    requestedByUserId: toId(row.requested_by_user_id),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

const first = (rows: Row[]) => (rows[0] ? toPayment(rows[0]) : null);

export async function findById(id: number, client: Db = pool): Promise<PaymentRecord | null> {
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM payments WHERE id = $1`, [id]);
  return first(rows);
}

export async function listForCommission(
  commissionId: number,
  client: Db = pool,
): Promise<PaymentRecord[]> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM payments WHERE commission_id = $1 ORDER BY created_at, id`,
    [commissionId],
  );
  return rows.map(toPayment);
}

// --- Incoming payments (deposit, final) ---

export async function insertIncoming(
  {
    commissionId,
    type,
    amountCents,
    currency,
  }: { commissionId: number; type: 'deposit' | 'final'; amountCents: number; currency: string },
  client: Db = pool,
): Promise<PaymentRecord> {
  const { rows } = await client.query(
    `INSERT INTO payments (commission_id, type, amount_cents, currency)
     VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [commissionId, type, amountCents, currency],
  );
  return toPayment(rows[0]);
}

export async function setCheckout(
  id: number,
  { sessionId, url, expiresAt }: { sessionId: string; url: string; expiresAt: Date },
  client: Db = pool,
): Promise<PaymentRecord> {
  const { rows } = await client.query(
    `UPDATE payments
        SET stripe_checkout_session_id = $2, checkout_url = $3, checkout_expires_at = $4
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, sessionId, url, expiresAt],
  );
  return toPayment(rows[0]);
}

/** A Checkout page for this stage that can still be paid until at least `openUntil`. */
export async function findOpenCheckout(
  commissionId: number,
  type: 'deposit' | 'final',
  openUntil: Date,
  client: Db = pool,
): Promise<PaymentRecord | null> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM payments
      WHERE commission_id = $1 AND type = $2 AND status = 'pending'
        AND checkout_url IS NOT NULL AND checkout_expires_at > $3
      ORDER BY id DESC LIMIT 1`,
    [commissionId, type, openUntil],
  );
  return first(rows);
}

/** Every Checkout page for a commission that hasn't been paid or closed yet. */
export async function listOpenCheckouts(
  commissionId: number,
  client: Db = pool,
): Promise<PaymentRecord[]> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM payments
      WHERE commission_id = $1 AND type <> 'refund' AND status = 'pending'
        AND stripe_checkout_session_id IS NOT NULL`,
    [commissionId],
  );
  return rows.map(toPayment);
}

export async function findBySessionId(
  sessionId: string,
  client: Db = pool,
): Promise<PaymentRecord | null> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM payments WHERE stripe_checkout_session_id = $1`,
    [sessionId],
  );
  return first(rows);
}

/** The deposit or final payment a Stripe payment intent belongs to. */
export async function findIncomingByIntent(
  paymentIntentId: string,
  client: Db = pool,
): Promise<PaymentRecord | null> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM payments
      WHERE stripe_payment_intent_id = $1 AND type <> 'refund'`,
    [paymentIntentId],
  );
  return first(rows);
}

export async function markSucceeded(
  id: number,
  paymentIntentId: string,
  client: Db = pool,
): Promise<void> {
  await client.query(
    `UPDATE payments SET status = 'succeeded', stripe_payment_intent_id = $2 WHERE id = $1`,
    [id, paymentIntentId],
  );
}

/** Only a still-pending payment expires; a paid one never goes back. */
export async function markExpired(id: number, client: Db = pool): Promise<void> {
  await client.query(
    `UPDATE payments SET status = 'expired' WHERE id = $1 AND status = 'pending'`,
    [id],
  );
}

// --- Refunds ---

export async function insertRefund(
  refund: {
    commissionId: number;
    refundedPaymentId: number;
    amountCents: number;
    currency: string;
    paymentIntentId: string | null;
    stripeRefundId: string | null;
    status: PaymentStatus;
    reason: string;
    requestedByUserId: number | null;
  },
  client: Db = pool,
): Promise<PaymentRecord> {
  const { rows } = await client.query(
    `INSERT INTO payments (commission_id, type, refunded_payment_id, amount_cents, currency,
                           stripe_payment_intent_id, stripe_refund_id, status, reason,
                           requested_by_user_id)
     VALUES ($1, 'refund', $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${COLUMNS}`,
    [
      refund.commissionId,
      refund.refundedPaymentId,
      refund.amountCents,
      refund.currency,
      refund.paymentIntentId,
      refund.stripeRefundId,
      refund.status,
      refund.reason,
      refund.requestedByUserId,
    ],
  );
  return toPayment(rows[0]);
}

export async function updateRefund(
  id: number,
  { stripeRefundId, status }: { stripeRefundId: string; status: PaymentStatus },
  client: Db = pool,
): Promise<PaymentRecord> {
  const { rows } = await client.query(
    `UPDATE payments SET stripe_refund_id = $2, status = $3 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, stripeRefundId, status],
  );
  return toPayment(rows[0]);
}

export async function findRefundByStripeId(
  stripeRefundId: string,
  client: Db = pool,
): Promise<PaymentRecord | null> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM payments WHERE stripe_refund_id = $1`,
    [stripeRefundId],
  );
  return first(rows);
}

/** Refunds of one payment that took money back or still may (pending + succeeded). */
export async function refundedOrPendingCents(
  paymentId: number,
  client: Db = pool,
): Promise<number> {
  const { rows } = await client.query(
    `SELECT coalesce(sum(amount_cents), 0)::int AS cents FROM payments
      WHERE refunded_payment_id = $1 AND status IN ('pending', 'succeeded')`,
    [paymentId],
  );
  return rows[0].cents;
}

/** Money in (succeeded deposits and final payments) and money back (succeeded refunds). */
export async function totals(
  commissionId: number,
  client: Db = pool,
): Promise<{ paidCents: number; refundedCents: number }> {
  const { rows } = await client.query(
    `SELECT coalesce(sum(amount_cents) FILTER (WHERE type <> 'refund'), 0)::int AS paid,
            coalesce(sum(amount_cents) FILTER (WHERE type = 'refund'), 0)::int AS refunded
       FROM payments WHERE commission_id = $1 AND status = 'succeeded'`,
    [commissionId],
  );
  return { paidCents: rows[0].paid, refundedCents: rows[0].refunded };
}

// --- Webhook deduplication ---

/**
 * Records a Stripe event as processed. Returns false if it already was: a duplicate
 * delivery. Runs inside the same transaction as the event's effects, so if handling fails
 * and rolls back, the event isn't marked processed and Stripe's retry is handled normally.
 */
export async function recordProcessedEvent(
  stripeEventId: string,
  eventType: string,
  client: Db = pool,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `INSERT INTO processed_webhook_events (stripe_event_id, event_type) VALUES ($1, $2)
     ON CONFLICT (stripe_event_id) DO NOTHING`,
    [stripeEventId, eventType],
  );
  return rowCount === 1;
}
