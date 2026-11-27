/**
 * SQL for postage labels and their tracking (milestone 11b): the shipping_labels and
 * tracking_events tables. Every function accepts an optional `client` so the service can
 * group calls in a transaction.
 */
import type { Pool, PoolClient } from 'pg';
import type { TrackingStatus } from '@shared/types/shipping.ts';
import type { RefundStatus, TrackingInfo, TrackingScan } from '../../adapters/shippo.ts';
import { pool } from '../../db/pool.js';

type Db = Pool | PoolClient;

export interface LabelRecord {
  id: number;
  shipmentId: number;
  commissionId: number;
  transactionId: string;
  carrier: string;
  serviceToken: string;
  serviceName: string;
  trackingNumber: string;
  trackingUrl: string | null;
  postageCents: number;
  trackingStatus: TrackingStatus;
  trackingDetails: string | null;
  trackingUpdatedAt: Date | null;
  eta: Date | null;
  problemNotifiedAt: Date | null;
  voidedAt: Date | null;
  refundId: string | null;
  refundStatus: RefundStatus | null;
  createdAt: Date;
}

export interface EventRecord {
  status: TrackingStatus;
  details: string | null;
  occurredAt: Date | null;
  city: string | null;
  state: string | null;
}

export interface NewLabel {
  shipmentId: number;
  transactionId: string;
  carrier: string;
  serviceToken: string;
  serviceName: string;
  trackingNumber: string;
  trackingUrl: string | null;
  postageCents: number;
}

const COLUMNS = `l.id, l.shipment_id, s.commission_id, l.provider_transaction_id, l.carrier,
  l.service_token, l.service_name, l.tracking_number, l.tracking_url, l.postage_cents,
  l.tracking_status, l.tracking_details, l.tracking_updated_at, l.eta, l.problem_notified_at,
  l.voided_at, l.refund_id, l.refund_status, l.created_at`;
const FROM = 'shipping_labels l JOIN shipments s ON s.id = l.shipment_id';

function toLabel(row: Record<string, unknown>): LabelRecord {
  return {
    id: Number(row.id),
    shipmentId: Number(row.shipment_id),
    commissionId: Number(row.commission_id),
    transactionId: row.provider_transaction_id as string,
    carrier: row.carrier as string,
    serviceToken: row.service_token as string,
    serviceName: row.service_name as string,
    trackingNumber: row.tracking_number as string,
    trackingUrl: row.tracking_url as string | null,
    postageCents: Number(row.postage_cents),
    trackingStatus: row.tracking_status as TrackingStatus,
    trackingDetails: row.tracking_details as string | null,
    trackingUpdatedAt: row.tracking_updated_at as Date | null,
    eta: row.eta as Date | null,
    problemNotifiedAt: row.problem_notified_at as Date | null,
    voidedAt: row.voided_at as Date | null,
    refundId: row.refund_id as string | null,
    refundStatus: row.refund_status as RefundStatus | null,
    createdAt: row.created_at as Date,
  };
}

export async function findById(id: number, client: Db = pool): Promise<LabelRecord | null> {
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE l.id = $1`, [id]);
  return rows[0] ? toLabel(rows[0]) : null;
}

/** Every label a commission has had, newest first (at most one isn't voided). */
export async function listForCommission(
  commissionId: number,
  client: Db = pool,
): Promise<LabelRecord[]> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${FROM} WHERE s.commission_id = $1 ORDER BY l.id DESC`,
    [commissionId],
  );
  return rows.map(toLabel);
}

/** The labels in use with this tracking number (normally one). */
export async function findActiveByTrackingNumber(
  trackingNumber: string,
  client: Db = pool,
): Promise<LabelRecord[]> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${FROM}
      WHERE l.tracking_number = $1 AND l.voided_at IS NULL
      ORDER BY l.id`,
    [trackingNumber],
  );
  return rows.map(toLabel);
}

/** Labels in use whose package isn't delivered yet, on commissions in these statuses. */
export async function findToTrack(
  commissionStatuses: readonly string[],
  client: Db = pool,
): Promise<LabelRecord[]> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${FROM} JOIN commissions c ON c.id = s.commission_id
      WHERE l.voided_at IS NULL AND l.tracking_status <> 'delivered'
        AND c.status = ANY($1::text[])
      ORDER BY l.id`,
    [commissionStatuses],
  );
  return rows.map(toLabel);
}

/** Voided labels whose refund hasn't been settled yet. */
export async function findPendingRefunds(client: Db = pool): Promise<LabelRecord[]> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${FROM}
      WHERE l.refund_status IN ('queued', 'pending')
      ORDER BY l.id`,
  );
  return rows.map(toLabel);
}

export async function insert(label: NewLabel, client: Db = pool): Promise<number> {
  const { rows } = await client.query(
    `INSERT INTO shipping_labels (shipment_id, provider_transaction_id, carrier, service_token,
                                  service_name, tracking_number, tracking_url, postage_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      label.shipmentId,
      label.transactionId,
      label.carrier,
      label.serviceToken,
      label.serviceName,
      label.trackingNumber,
      label.trackingUrl,
      label.postageCents,
    ],
  );
  return Number(rows[0].id);
}

export async function markVoided(
  id: number,
  refund: { id: string; status: RefundStatus },
  client: Db = pool,
): Promise<void> {
  await client.query(
    `UPDATE shipping_labels SET voided_at = now(), refund_id = $2, refund_status = $3
      WHERE id = $1`,
    [id, refund.id, refund.status],
  );
}

export async function setRefundStatus(
  id: number,
  status: RefundStatus,
  client: Db = pool,
): Promise<void> {
  await client.query('UPDATE shipping_labels SET refund_status = $2 WHERE id = $1', [id, status]);
}

/** Saves where the package is now (from the shipping service's answer). */
export async function updateTracking(
  id: number,
  info: Pick<TrackingInfo, 'status' | 'details' | 'updatedAt' | 'eta'>,
  client: Db = pool,
): Promise<void> {
  await client.query(
    `UPDATE shipping_labels
        SET tracking_status = $2, tracking_details = $3, tracking_updated_at = $4, eta = $5
      WHERE id = $1`,
    [id, info.status, info.details, info.updatedAt, info.eta],
  );
}

/**
 * Marks the owner as told about a delivery problem. Returns false if they already were, so
 * the alert is sent once per label however many updates repeat it.
 */
export async function markProblemNotified(id: number, client: Db = pool): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE shipping_labels SET problem_notified_at = now()
      WHERE id = $1 AND problem_notified_at IS NULL`,
    [id],
  );
  return rowCount === 1;
}

/** Adds the scans not recorded yet (a repeated update adds nothing). */
export async function insertEvents(
  labelId: number,
  scans: TrackingScan[],
  client: Db = pool,
): Promise<void> {
  for (const scan of scans) {
    await client.query(
      `INSERT INTO tracking_events (label_id, provider_event_id, status, details, occurred_at,
                                    city, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ON CONSTRAINT tracking_events_label_event_key DO NOTHING`,
      [labelId, scan.id, scan.status, scan.details, scan.occurredAt, scan.city, scan.state],
    );
  }
}

/** A label's scans, newest first. */
export async function listEvents(labelId: number, client: Db = pool): Promise<EventRecord[]> {
  const { rows } = await client.query(
    `SELECT status, details, occurred_at, city, state FROM tracking_events
      WHERE label_id = $1
      ORDER BY occurred_at DESC NULLS LAST, id DESC`,
    [labelId],
  );
  return rows.map((row) => ({
    status: row.status as TrackingStatus,
    details: row.details as string | null,
    occurredAt: row.occurred_at as Date | null,
    city: row.city as string | null,
    state: row.state as string | null,
  }));
}
