/**
 * SQL for the shipments table (milestone 11). Every function accepts an optional `client`
 * so the service can group calls in a transaction.
 */
import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

type Db = Pool | PoolClient;

export interface AddressFields {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
}

export interface ParcelFields {
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

export interface ChoiceFields {
  rateId: string;
  carrier: string;
  serviceToken: string;
  serviceName: string;
  estimatedDays: number | null;
  postageCents: number;
  packagingFeeCents: number;
}

export interface ShipmentRecord {
  id: number;
  /** What it belongs to: a commission, or a shop order (milestone 12c). */
  commissionId: number | null;
  orderId: number | null;
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  addressRemovedAt: Date | null;
  parcel: ParcelFields | null;
  providerShipmentId: string | null;
  choice: ChoiceFields | null;
  rateChosenAt: Date | null;
  /** The latest prices fetched for buying the label (milestone 11b). */
  labelQuoteId: string | null;
  updatedAt: Date;
}

const COLUMNS = `id, commission_id, order_id, recipient_name, address_line1, address_line2, city, state,
  postal_code, address_removed_at, weight_oz, length_in, width_in, height_in,
  provider_shipment_id, rate_id, carrier, service_token, service_name, estimated_days,
  postage_cents, packaging_fee_cents, rate_chosen_at, label_quote_id, updated_at`;

/** Clearing these forgets the chosen option. */
const CLEAR_CHOICE = `rate_id = NULL, carrier = NULL, service_token = NULL, service_name = NULL,
  estimated_days = NULL, postage_cents = NULL, packaging_fee_cents = NULL, rate_chosen_at = NULL`;
/** Clearing these forgets the quote and the chosen option. */
const CLEAR_QUOTE = `provider_shipment_id = NULL, ${CLEAR_CHOICE}`;

function toShipment(row: Record<string, unknown>): ShipmentRecord {
  return {
    id: Number(row.id),
    commissionId: row.commission_id === null ? null : Number(row.commission_id),
    orderId: row.order_id === null ? null : Number(row.order_id),
    name: row.recipient_name as string | null,
    line1: row.address_line1 as string | null,
    line2: row.address_line2 as string | null,
    city: row.city as string | null,
    state: row.state as string | null,
    postalCode: row.postal_code as string | null,
    addressRemovedAt: row.address_removed_at as Date | null,
    // numeric columns arrive as text
    parcel:
      row.weight_oz === null
        ? null
        : {
            weightOz: Number(row.weight_oz),
            lengthIn: Number(row.length_in),
            widthIn: Number(row.width_in),
            heightIn: Number(row.height_in),
          },
    providerShipmentId: row.provider_shipment_id as string | null,
    choice:
      row.rate_id === null
        ? null
        : {
            rateId: row.rate_id as string,
            carrier: row.carrier as string,
            serviceToken: row.service_token as string,
            serviceName: row.service_name as string,
            estimatedDays: row.estimated_days === null ? null : Number(row.estimated_days),
            postageCents: Number(row.postage_cents),
            packagingFeeCents: Number(row.packaging_fee_cents),
          },
    rateChosenAt: row.rate_chosen_at as Date | null,
    labelQuoteId: row.label_quote_id as string | null,
    updatedAt: row.updated_at as Date,
  };
}

export async function findByCommission(
  commissionId: number,
  client: Db = pool,
): Promise<ShipmentRecord | null> {
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM shipments WHERE commission_id = $1`, [
    commissionId,
  ]);
  return rows[0] ? toShipment(rows[0]) : null;
}

/** Sets the address (creating the row if needed) and forgets any quote made for the old one. */
export async function saveAddress(
  commissionId: number,
  address: AddressFields,
  client: Db = pool,
): Promise<ShipmentRecord> {
  const { rows } = await client.query(
    `INSERT INTO shipments (commission_id, recipient_name, address_line1, address_line2, city,
                            state, postal_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ON CONSTRAINT shipments_commission_id_key DO UPDATE SET
       recipient_name = EXCLUDED.recipient_name, address_line1 = EXCLUDED.address_line1,
       address_line2 = EXCLUDED.address_line2, city = EXCLUDED.city, state = EXCLUDED.state,
       postal_code = EXCLUDED.postal_code, address_removed_at = NULL, ${CLEAR_QUOTE}
     RETURNING ${COLUMNS}`,
    [
      commissionId,
      address.name,
      address.line1,
      address.line2,
      address.city,
      address.state,
      address.postalCode,
    ],
  );
  return toShipment(rows[0]);
}

/** Sets the package (creating the row if needed) and forgets any quote made for the old one. */
export async function savePackage(
  commissionId: number,
  parcel: ParcelFields,
  client: Db = pool,
): Promise<ShipmentRecord> {
  const { rows } = await client.query(
    `INSERT INTO shipments (commission_id, weight_oz, length_in, width_in, height_in)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ON CONSTRAINT shipments_commission_id_key DO UPDATE SET
       weight_oz = EXCLUDED.weight_oz, length_in = EXCLUDED.length_in,
       width_in = EXCLUDED.width_in, height_in = EXCLUDED.height_in, ${CLEAR_QUOTE}
     RETURNING ${COLUMNS}`,
    [commissionId, parcel.weightOz, parcel.lengthIn, parcel.widthIn, parcel.heightIn],
  );
  return toShipment(rows[0]);
}

/** Records a new quote from the shipping service; the earlier choice no longer applies. */
export async function saveQuote(
  commissionId: number,
  providerShipmentId: string,
  client: Db = pool,
): Promise<ShipmentRecord> {
  const { rows } = await client.query(
    `UPDATE shipments SET ${CLEAR_CHOICE}, provider_shipment_id = $2
      WHERE commission_id = $1
      RETURNING ${COLUMNS}`,
    [commissionId, providerShipmentId],
  );
  return toShipment(rows[0]);
}

export async function saveChoice(
  commissionId: number,
  choice: ChoiceFields,
  client: Db = pool,
): Promise<ShipmentRecord> {
  const { rows } = await client.query(
    `UPDATE shipments SET rate_id = $2, carrier = $3, service_token = $4, service_name = $5,
            estimated_days = $6, postage_cents = $7, packaging_fee_cents = $8,
            rate_chosen_at = now()
      WHERE commission_id = $1
      RETURNING ${COLUMNS}`,
    [
      commissionId,
      choice.rateId,
      choice.carrier,
      choice.serviceToken,
      choice.serviceName,
      choice.estimatedDays,
      choice.postageCents,
      choice.packagingFeeCents,
    ],
  );
  return toShipment(rows[0]);
}

/** Records (or, with null, forgets) the prices fetched for buying the label. */
export async function saveLabelQuote(
  shipmentId: number,
  labelQuoteId: string | null,
  client: Db = pool,
): Promise<void> {
  await client.query('UPDATE shipments SET label_quote_id = $2 WHERE id = $1', [
    shipmentId,
    labelQuoteId,
  ]);
}

export async function findByOrder(
  orderId: number,
  client: Db = pool,
): Promise<ShipmentRecord | null> {
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM shipments WHERE order_id = $1`, [
    orderId,
  ]);
  return rows[0] ? toShipment(rows[0]) : null;
}

/** Shipments of these orders (for lists). */
export async function findByOrders(
  orderIds: number[],
  client: Db = pool,
): Promise<ShipmentRecord[]> {
  if (orderIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM shipments WHERE order_id = ANY($1::bigint[])`,
    [orderIds],
  );
  return rows.map(toShipment);
}

/**
 * A shop order's shipment, recorded whole at checkout (milestone 12c): the address the
 * carrier standardized, the package the order was packed into, and the option chosen.
 */
export async function insertOrderShipment(
  orderId: number,
  {
    address,
    parcel,
    providerShipmentId,
    choice,
  }: {
    address: AddressFields;
    parcel: ParcelFields;
    providerShipmentId: string;
    choice: ChoiceFields;
  },
  client: Db = pool,
): Promise<ShipmentRecord> {
  const { rows } = await client.query(
    `INSERT INTO shipments (order_id, recipient_name, address_line1, address_line2, city, state,
                            postal_code, weight_oz, length_in, width_in, height_in,
                            provider_shipment_id, rate_id, carrier, service_token, service_name,
                            estimated_days, postage_cents, packaging_fee_cents, rate_chosen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19, now())
     RETURNING ${COLUMNS}`,
    [
      orderId,
      address.name,
      address.line1,
      address.line2,
      address.city,
      address.state,
      address.postalCode,
      parcel.weightOz,
      parcel.lengthIn,
      parcel.widthIn,
      parcel.heightIn,
      providerShipmentId,
      choice.rateId,
      choice.carrier,
      choice.serviceToken,
      choice.serviceName,
      choice.estimatedDays,
      choice.postageCents,
      choice.packagingFeeCents,
    ],
  );
  return toShipment(rows[0]);
}

/** The address of a client's latest shipped shop order, to fill in the next one. */
export async function lastOrderAddress(
  clientId: number,
  client: Db = pool,
): Promise<ShipmentRecord | null> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS.split(',')
      .map((c) => `s.${c.trim()}`)
      .join(', ')}
       FROM shipments s JOIN orders o ON o.id = s.order_id
      WHERE o.client_id = $1 AND s.address_line1 IS NOT NULL
        AND o.status IN ('paid', 'shipped', 'delivered')
      ORDER BY o.id DESC LIMIT 1`,
    [clientId],
  );
  return rows[0] ? toShipment(rows[0]) : null;
}

/**
 * Account deletion: removes the name and street from every shipment to this client's
 * commissions and shop orders, keeping the city, state, and ZIP for records. Returns how many
 * changed.
 */
export async function removeStreetForClient(clientId: number, client: Db = pool) {
  const { rowCount } = await client.query(
    `UPDATE shipments
        SET recipient_name = NULL, address_line1 = NULL, address_line2 = NULL,
            address_removed_at = now()
      WHERE address_line1 IS NOT NULL
        AND (commission_id IN (SELECT id FROM commissions WHERE client_id = $1)
             OR order_id IN (SELECT id FROM orders WHERE client_id = $1))`,
    [clientId],
  );
  return rowCount ?? 0;
}
