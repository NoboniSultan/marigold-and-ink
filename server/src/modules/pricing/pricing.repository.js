import { pool } from '../../db/pool.js';

function toRule(row) {
  return {
    id: row.id,
    ruleType: row.rule_type,
    size: row.size,
    medium: row.medium,
    fulfillmentType: row.fulfillment_type,
    amountCents: row.amount_cents,
  };
}

/** All active pricing rules. Small table, so the engine gets the whole set at once. */
export async function findActiveRules(client = pool) {
  const { rows } = await client.query(
    `SELECT id, rule_type, size, medium, fulfillment_type, amount_cents
     FROM pricing_rules
     WHERE is_active
     ORDER BY rule_type, size, medium, fulfillment_type`,
  );
  return rows.map(toRule);
}

export async function hasActiveBaseRule({ size, medium }, client = pool) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM pricing_rules
       WHERE is_active AND rule_type = 'base' AND size = $1 AND medium = $2
     ) AS found`,
    [size, medium],
  );
  return rows[0].found;
}
