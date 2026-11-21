import { pool } from '../../db/pool.js';

const COLUMNS = `id, commission_id, computed_amount_cents, adjusted_amount_cents, adjustment_note,
  line_items, status, sent_at, created_at, updated_at`;

function toQuote(row) {
  if (!row) return null;
  return {
    id: row.id,
    commissionId: row.commission_id,
    computedAmountCents: row.computed_amount_cents,
    adjustedAmountCents: row.adjusted_amount_cents,
    adjustmentNote: row.adjustment_note,
    lineItems: row.line_items,
    status: row.status,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The commission's current quote (any status except superseded), or null. */
export async function findCurrent(commissionId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM quotes WHERE commission_id = $1 AND status <> 'superseded'`,
    [commissionId],
  );
  return toQuote(rows[0]);
}

export async function insertDraft({ commissionId, computedAmountCents, lineItems }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO quotes (commission_id, computed_amount_cents, line_items, status)
     VALUES ($1, $2, $3, 'draft')
     RETURNING ${COLUMNS}`,
    [commissionId, computedAmountCents, JSON.stringify(lineItems)],
  );
  return toQuote(rows[0]);
}

export async function supersede(id, client = pool) {
  await client.query(`UPDATE quotes SET status = 'superseded' WHERE id = $1`, [id]);
}

export async function setAdjustment(id, { adjustedAmountCents, adjustmentNote }, client = pool) {
  const { rows } = await client.query(
    `UPDATE quotes SET adjusted_amount_cents = $2, adjustment_note = $3
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, adjustedAmountCents, adjustmentNote],
  );
  return toQuote(rows[0]);
}

export async function markSent(id, client = pool) {
  const { rows } = await client.query(
    `UPDATE quotes SET status = 'sent', sent_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  );
  return toQuote(rows[0]);
}
