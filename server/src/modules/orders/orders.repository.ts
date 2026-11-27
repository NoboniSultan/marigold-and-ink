/**
 * SQL for shop orders (milestone 12b): orders, their items, status history, and refunds.
 * Every function accepts an optional `client` so the service can group calls in a
 * transaction.
 */
import type { Pool, PoolClient } from 'pg';
import type { OrderStatus } from '@shared/types/order.ts';
import { pool } from '../../db/pool.js';

type Db = Pool | PoolClient;
type Row = Record<string, unknown>;

export interface OrderRecord {
  id: number;
  clientId: number;
  status: OrderStatus;
  subtotalCents: number;
  /** Postage and packaging charged at checkout (0 for a pickup). */
  shippingCents: number;
  pickup: boolean;
  currency: string;
  stripeCheckoutSessionId: string | null;
  checkoutUrl: string | null;
  checkoutExpiresAt: Date | null;
  stripePaymentIntentId: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface OrderItemRecord {
  orderId: number;
  variantId: number;
  productName: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
}

export interface OrderEventRecord {
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  actorType: 'client' | 'admin' | 'system';
  reason: string | null;
  createdAt: Date;
}

export interface OrderRefundRecord {
  id: number;
  orderId: number;
  amountCents: number;
  status: 'pending' | 'succeeded' | 'failed';
  stripeRefundId: string | null;
  reason: string;
  restock: boolean;
  restockedAt: Date | null;
  requestedByUserId: number | null;
  createdAt: Date;
}

const ORDER_COLUMNS = `id, client_id, status, subtotal_cents, shipping_cents, pickup, currency,
  stripe_checkout_session_id,
  checkout_url, checkout_expires_at, stripe_payment_intent_id, paid_at, created_at`;
const REFUND_COLUMNS = `id, order_id, amount_cents, status, stripe_refund_id, reason, restock,
  restocked_at, requested_by_user_id, created_at`;

function toOrder(row: Row): OrderRecord {
  return {
    id: Number(row.id),
    clientId: Number(row.client_id),
    status: row.status as OrderStatus,
    subtotalCents: Number(row.subtotal_cents),
    shippingCents: Number(row.shipping_cents),
    pickup: row.pickup as boolean,
    currency: row.currency as string,
    stripeCheckoutSessionId: row.stripe_checkout_session_id as string | null,
    checkoutUrl: row.checkout_url as string | null,
    checkoutExpiresAt: row.checkout_expires_at as Date | null,
    stripePaymentIntentId: row.stripe_payment_intent_id as string | null,
    paidAt: row.paid_at as Date | null,
    createdAt: row.created_at as Date,
  };
}

function toRefund(row: Row): OrderRefundRecord {
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    amountCents: Number(row.amount_cents),
    status: row.status as OrderRefundRecord['status'],
    stripeRefundId: row.stripe_refund_id as string | null,
    reason: row.reason as string,
    restock: row.restock as boolean,
    restockedAt: row.restocked_at as Date | null,
    requestedByUserId: row.requested_by_user_id === null ? null : Number(row.requested_by_user_id),
    createdAt: row.created_at as Date,
  };
}

const lock = (forUpdate: boolean) => (forUpdate ? ' FOR UPDATE' : '');

// --- Orders ---

export async function insertOrder(
  {
    clientId,
    subtotalCents,
    shippingCents = 0,
    pickup = false,
    currency,
  }: {
    clientId: number;
    subtotalCents: number;
    shippingCents?: number;
    pickup?: boolean;
    currency: string;
  },
  client: Db = pool,
): Promise<OrderRecord> {
  const { rows } = await client.query(
    `INSERT INTO orders (client_id, subtotal_cents, shipping_cents, pickup, currency)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${ORDER_COLUMNS}`,
    [clientId, subtotalCents, shippingCents, pickup, currency],
  );
  return toOrder(rows[0]);
}

export async function setSubtotal(id: number, subtotalCents: number, client: Db = pool) {
  await client.query('UPDATE orders SET subtotal_cents = $2 WHERE id = $1', [id, subtotalCents]);
}

export async function findById(
  id: number,
  client: Db = pool,
  { forUpdate = false } = {},
): Promise<OrderRecord | null> {
  const { rows } = await client.query(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1${lock(forUpdate)}`,
    [id],
  );
  return rows[0] ? toOrder(rows[0]) : null;
}

export async function findBySessionId(
  sessionId: string,
  client: Db = pool,
): Promise<OrderRecord | null> {
  const { rows } = await client.query(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE stripe_checkout_session_id = $1`,
    [sessionId],
  );
  return rows[0] ? toOrder(rows[0]) : null;
}

export async function findByPaymentIntent(
  paymentIntentId: string,
  client: Db = pool,
): Promise<OrderRecord | null> {
  const { rows } = await client.query(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE stripe_payment_intent_id = $1`,
    [paymentIntentId],
  );
  return rows[0] ? toOrder(rows[0]) : null;
}

/** A client's orders, newest first. Unpaid ones that ended (expired, canceled) are left out. */
export async function listForClient(
  clientId: number,
  { limit, offset }: { limit: number; offset: number },
  client: Db = pool,
): Promise<{ orders: OrderRecord[]; total: number }> {
  const where = `WHERE client_id = $1 AND status NOT IN ('expired', 'canceled')`;
  const [{ rows }, count] = await Promise.all([
    client.query(
      `SELECT ${ORDER_COLUMNS} FROM orders ${where} ORDER BY id DESC LIMIT $2 OFFSET $3`,
      [clientId, limit, offset],
    ),
    client.query(`SELECT count(*)::int AS total FROM orders ${where}`, [clientId]),
  ]);
  return { orders: rows.map(toOrder), total: count.rows[0].total };
}

/** Every order, newest first, optionally one status. */
export async function listAll(
  { status, limit, offset }: { status?: OrderStatus; limit: number; offset: number },
  client: Db = pool,
): Promise<{ orders: OrderRecord[]; total: number }> {
  const where = 'WHERE ($1::text IS NULL OR status = $1)';
  const [{ rows }, count] = await Promise.all([
    client.query(
      `SELECT ${ORDER_COLUMNS} FROM orders ${where} ORDER BY id DESC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset],
    ),
    client.query(`SELECT count(*)::int AS total FROM orders ${where}`, [status ?? null]),
  ]);
  return { orders: rows.map(toOrder), total: count.rows[0].total };
}

/** A client's orders still waiting for payment, locked. */
export async function lockPendingForClient(clientId: number, client: Db): Promise<OrderRecord[]> {
  const { rows } = await client.query(
    `SELECT ${ORDER_COLUMNS} FROM orders
      WHERE client_id = $1 AND status = 'pending_payment' ORDER BY id FOR UPDATE`,
    [clientId],
  );
  return rows.map(toOrder);
}

/** Pending orders whose Stripe page should have closed before `before`. */
export async function pendingExpiredBefore(
  before: Date,
  client: Db = pool,
): Promise<OrderRecord[]> {
  const { rows } = await client.query(
    `SELECT ${ORDER_COLUMNS} FROM orders
      WHERE status = 'pending_payment' AND checkout_expires_at < $1 ORDER BY id`,
    [before],
  );
  return rows.map(toOrder);
}

export async function setCheckout(
  id: number,
  { sessionId, url, expiresAt }: { sessionId: string; url: string; expiresAt: Date },
  client: Db = pool,
) {
  await client.query(
    `UPDATE orders SET stripe_checkout_session_id = $2, checkout_url = $3, checkout_expires_at = $4
      WHERE id = $1`,
    [id, sessionId, url, expiresAt],
  );
}

export async function markPaid(id: number, paymentIntentId: string, client: Db = pool) {
  await client.query(
    'UPDATE orders SET paid_at = now(), stripe_payment_intent_id = $2 WHERE id = $1',
    [id, paymentIntentId],
  );
}

export async function setStatus(id: number, status: OrderStatus, client: Db = pool) {
  await client.query('UPDATE orders SET status = $2 WHERE id = $1', [id, status]);
}

// --- Items ---

export async function insertItems(
  orderId: number,
  items: Omit<OrderItemRecord, 'orderId'>[],
  client: Db = pool,
) {
  for (const item of items) {
    await client.query(
      `INSERT INTO order_items (order_id, variant_id, product_name, variant_name, unit_price_cents,
                                quantity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        orderId,
        item.variantId,
        item.productName,
        item.variantName,
        item.unitPriceCents,
        item.quantity,
      ],
    );
  }
}

export async function itemsFor(orderIds: number[], client: Db = pool): Promise<OrderItemRecord[]> {
  if (orderIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT order_id, variant_id, product_name, variant_name, unit_price_cents, quantity
       FROM order_items WHERE order_id = ANY($1::bigint[]) ORDER BY id`,
    [orderIds],
  );
  return rows.map((row) => ({
    orderId: Number(row.order_id),
    variantId: Number(row.variant_id),
    productName: row.product_name as string,
    variantName: row.variant_name as string,
    unitPriceCents: Number(row.unit_price_cents),
    quantity: Number(row.quantity),
  }));
}

// --- Events ---

export async function insertEvent(
  event: {
    orderId: number;
    fromStatus: OrderStatus;
    toStatus: OrderStatus;
    actorType: 'client' | 'admin' | 'system';
    actorUserId: number | null;
    reason: string | null;
  },
  client: Db = pool,
) {
  await client.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_user_id, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      event.orderId,
      event.fromStatus,
      event.toStatus,
      event.actorType,
      event.actorUserId,
      event.reason,
    ],
  );
}

export async function eventsFor(orderId: number, client: Db = pool): Promise<OrderEventRecord[]> {
  const { rows } = await client.query(
    `SELECT from_status, to_status, actor_type, reason, created_at FROM order_events
      WHERE order_id = $1 ORDER BY id`,
    [orderId],
  );
  return rows.map((row) => ({
    fromStatus: row.from_status as OrderStatus,
    toStatus: row.to_status as OrderStatus,
    actorType: row.actor_type as OrderEventRecord['actorType'],
    reason: row.reason as string | null,
    createdAt: row.created_at as Date,
  }));
}

// --- Refunds ---

export async function insertRefund(
  refund: Omit<OrderRefundRecord, 'id' | 'restockedAt' | 'createdAt'>,
  client: Db = pool,
): Promise<OrderRefundRecord> {
  const { rows } = await client.query(
    `INSERT INTO order_refunds (order_id, amount_cents, status, stripe_refund_id, reason, restock,
                                requested_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${REFUND_COLUMNS}`,
    [
      refund.orderId,
      refund.amountCents,
      refund.status,
      refund.stripeRefundId,
      refund.reason,
      refund.restock,
      refund.requestedByUserId,
    ],
  );
  return toRefund(rows[0]);
}

export async function updateRefund(
  id: number,
  { status, stripeRefundId }: { status: OrderRefundRecord['status']; stripeRefundId: string },
  client: Db = pool,
): Promise<OrderRefundRecord> {
  const { rows } = await client.query(
    `UPDATE order_refunds SET status = $2, stripe_refund_id = $3 WHERE id = $1
     RETURNING ${REFUND_COLUMNS}`,
    [id, status, stripeRefundId],
  );
  return toRefund(rows[0]);
}

export async function markRestocked(id: number, client: Db = pool) {
  await client.query('UPDATE order_refunds SET restocked_at = now() WHERE id = $1', [id]);
}

export async function findRefundByStripeId(
  stripeRefundId: string,
  client: Db = pool,
): Promise<OrderRefundRecord | null> {
  const { rows } = await client.query(
    `SELECT ${REFUND_COLUMNS} FROM order_refunds WHERE stripe_refund_id = $1`,
    [stripeRefundId],
  );
  return rows[0] ? toRefund(rows[0]) : null;
}

export async function refundsFor(
  orderIds: number[],
  client: Db = pool,
): Promise<OrderRefundRecord[]> {
  if (orderIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT ${REFUND_COLUMNS} FROM order_refunds WHERE order_id = ANY($1::bigint[]) ORDER BY id`,
    [orderIds],
  );
  return rows.map(toRefund);
}

// --- The monthly report ---

/**
 * Shop sales (paid orders with their shipping, by when paid), the shipping part, and refunds
 * (succeeded, by when made), per month.
 */
export async function monthlyShop(
  year: number,
  timeZone: string,
  client: Db = pool,
): Promise<{ month: string; salesCents: number; shippingCents: number; refundsCents: number }[]> {
  const { rows } = await client.query(
    `WITH months AS (
       SELECT m::date AS starts, (m + interval '1 month')::date AS ends
         FROM generate_series(make_date($1, 1, 1), make_date($1, 12, 1), interval '1 month') AS m
     ),
     sales AS (
       SELECT (paid_at AT TIME ZONE $2)::date AS day, subtotal_cents + shipping_cents AS cents,
              shipping_cents AS shipping
         FROM orders WHERE paid_at IS NOT NULL
     ),
     refunds AS (
       SELECT (created_at AT TIME ZONE $2)::date AS day, amount_cents AS cents
         FROM order_refunds WHERE status = 'succeeded'
     )
     SELECT to_char(months.starts, 'YYYY-MM') AS month,
       coalesce((SELECT sum(cents) FROM sales
                  WHERE day >= months.starts AND day < months.ends), 0)::int AS sales_cents,
       coalesce((SELECT sum(shipping) FROM sales
                  WHERE day >= months.starts AND day < months.ends), 0)::int AS shipping_cents,
       coalesce((SELECT sum(cents) FROM refunds
                  WHERE day >= months.starts AND day < months.ends), 0)::int AS refunds_cents
       FROM months ORDER BY months.starts`,
    [year, timeZone],
  );
  return rows.map((row) => ({
    month: row.month as string,
    salesCents: Number(row.sales_cents),
    shippingCents: Number(row.shipping_cents),
    refundsCents: Number(row.refunds_cents),
  }));
}
