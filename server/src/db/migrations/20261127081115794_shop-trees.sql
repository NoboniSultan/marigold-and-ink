-- Up Migration

-- Trees for shop orders (milestone 12d, ADR 0022). A donation comes from a commission's final
-- payment, or from a shop order once it's delivered (orders have no `payments` rows: Stripe's
-- payment is on the order itself). Shop orders only ever fund trees.
ALTER TABLE donations
  ALTER COLUMN payment_id DROP NOT NULL,
  ALTER COLUMN commission_id DROP NOT NULL,
  ADD COLUMN order_id bigint REFERENCES orders (id) ON DELETE RESTRICT,
  -- One donation per order: delivering it twice (tracking and the admin) records it once.
  ADD CONSTRAINT donations_order_id_key UNIQUE (order_id),
  ADD CONSTRAINT donations_source_check CHECK (
    (order_id IS NULL AND payment_id IS NOT NULL AND commission_id IS NOT NULL)
    OR (order_id IS NOT NULL AND payment_id IS NULL AND commission_id IS NULL
        AND tree_count IS NOT NULL)
  );

-- Down Migration

-- Refuses (NOT NULL) while order donations exist, rather than deleting money history.
ALTER TABLE donations
  DROP CONSTRAINT donations_source_check,
  DROP CONSTRAINT donations_order_id_key,
  DROP COLUMN order_id,
  ALTER COLUMN commission_id SET NOT NULL,
  ALTER COLUMN payment_id SET NOT NULL;
