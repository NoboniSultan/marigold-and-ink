import { pool } from '../../db/pool.js';

const COLUMNS = `id, client_id, size, medium, subject_count, fulfillment_type, is_rush, notes,
  status, revision_count, revision_limit, quoted_total_cents, deposit_cents, balance_cents,
  created_at, updated_at`;

const EVENT_COLUMNS = `id, commission_id, from_status, to_status, actor_type, actor_user_id,
  reason, metadata, created_at`;

function toCommission(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    size: row.size,
    medium: row.medium,
    subjectCount: row.subject_count,
    fulfillmentType: row.fulfillment_type,
    isRush: row.is_rush,
    notes: row.notes,
    status: row.status,
    revisionCount: row.revision_count,
    revisionLimit: row.revision_limit,
    quotedTotalCents: row.quoted_total_cents,
    depositCents: row.deposit_cents,
    balanceCents: row.balance_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEvent(row) {
  return {
    id: row.id,
    commissionId: row.commission_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorType: row.actor_type,
    actorUserId: row.actor_user_id,
    reason: row.reason,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export async function insert(input, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO commissions
       (client_id, size, medium, subject_count, fulfillment_type, is_rush, notes, revision_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [
      input.clientId,
      input.size,
      input.medium,
      input.subjectCount,
      input.fulfillmentType,
      input.isRush,
      input.notes,
      input.revisionLimit,
    ],
  );
  return toCommission(rows[0]);
}

/**
 * `forUpdate: true` locks the row until the transaction ends (SELECT ... FOR UPDATE), so a
 * concurrent status change waits and then sees the new status instead of a stale one.
 * Only meaningful when `client` is a transaction client.
 */
export async function findById(id, client = pool, { forUpdate = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM commissions WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return toCommission(rows[0]);
}

export async function list({ clientId, status, limit, offset }, client = pool) {
  // Optional filters as parameters: `$1::bigint IS NULL OR ...` keeps one fixed, fully
  // parameterized query instead of building SQL strings from input.
  const { rows } = await client.query(
    `SELECT ${COLUMNS}, count(*) OVER () AS total
     FROM commissions
     WHERE ($1::bigint IS NULL OR client_id = $1)
       AND ($2::commission_status IS NULL OR status = $2)
     ORDER BY created_at DESC, id DESC
     LIMIT $3 OFFSET $4`,
    [clientId ?? null, status ?? null, limit, offset],
  );
  const total = rows.length > 0 ? rows[0].total : await count({ clientId, status }, client);
  return { commissions: rows.map(toCommission), total };
}

async function count({ clientId, status }, client) {
  const { rows } = await client.query(
    `SELECT count(*) AS total FROM commissions
     WHERE ($1::bigint IS NULL OR client_id = $1)
       AND ($2::commission_status IS NULL OR status = $2)`,
    [clientId ?? null, status ?? null],
  );
  return rows[0].total;
}

// Fields a status change may update, mapped to their columns. Keys come from code, never
// from request input, and every value is a bound parameter.
const UPDATABLE = {
  status: 'status',
  revisionCount: 'revision_count',
  quotedTotalCents: 'quoted_total_cents',
  depositCents: 'deposit_cents',
  balanceCents: 'balance_cents',
};

/** A client's commissions, oldest first, locked for the rest of the transaction. */
export async function listForClientForUpdate(clientId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM commissions WHERE client_id = $1 ORDER BY id FOR UPDATE`,
    [clientId],
  );
  return rows.map(toCommission);
}

/**
 * Account deletion: the free-text notes may describe the people or pets in the piece.
 * (commission_events is append-only, so reasons typed with a status change stay; ADR 0012.)
 */
export async function clearNotesForClient(clientId, client = pool) {
  await client.query('UPDATE commissions SET notes = NULL WHERE client_id = $1', [clientId]);
}

export async function update(id, changes, client = pool) {
  const entries = Object.entries(changes);
  const unknown = entries.filter(([key]) => !UPDATABLE[key]).map(([key]) => key);
  if (unknown.length > 0) throw new Error(`Cannot update commission fields: ${unknown.join(', ')}`);

  const assignments = entries.map(([key], i) => `${UPDATABLE[key]} = $${i + 2}`);
  const { rows } = await client.query(
    `UPDATE commissions SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, ...entries.map(([, value]) => value)],
  );
  return toCommission(rows[0]);
}

export async function insertEvent(event, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO commission_events
       (commission_id, from_status, to_status, actor_type, actor_user_id, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${EVENT_COLUMNS}`,
    [
      event.commissionId,
      event.fromStatus,
      event.toStatus,
      event.actorType,
      event.actorUserId,
      event.reason,
      event.metadata ?? {},
    ],
  );
  return toEvent(rows[0]);
}

export async function listEvents(commissionId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${EVENT_COLUMNS} FROM commission_events WHERE commission_id = $1 ORDER BY created_at, id`,
    [commissionId],
  );
  return rows.map(toEvent);
}

/**
 * For each commission: its status, when it was first paid in full (the balance moved it to
 * ready_to_ship or delivered), and, once it has ended (completed, canceled, or refunded),
 * when it reached that status. The files module dates its deletions from these (ADR 0016).
 */
export async function milestoneTimes(commissionIds, client = pool) {
  if (commissionIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT c.id, c.status,
       (SELECT min(e.created_at) FROM commission_events e
         WHERE e.commission_id = c.id AND e.to_status IN ('ready_to_ship', 'delivered'))
         AS paid_in_full_at,
       CASE WHEN c.status IN ('completed', 'canceled', 'refunded') THEN
         (SELECT max(e.created_at) FROM commission_events e
           WHERE e.commission_id = c.id AND e.to_status = c.status)
       END AS ended_at
     FROM commissions c WHERE c.id = ANY($1::bigint[])`,
    [commissionIds],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    status: row.status,
    paidInFullAt: row.paid_in_full_at,
    endedAt: row.ended_at,
  }));
}
