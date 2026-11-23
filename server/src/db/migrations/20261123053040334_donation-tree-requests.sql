-- Up Migration

-- Giving through Digital Humani (ADR 0013): a fully paid commission's donation becomes a
-- number of trees ($1 each, rounded up so the share is never below the promise), requested
-- from Digital Humani's planting partner.
--
-- Status, for these rows:
--   pending:  recorded with the final payment; the tree request hasn't gone through yet
--   owed:     Digital Humani accepted the request; the planting partner will invoice the owner
--   paid:     the owner paid that invoice (payout_date, receipt_reference)
--   reversed: never requested (a full refund came first)
ALTER TABLE donations ADD COLUMN tree_count integer;
-- Digital Humani's ID for the request, once it went through.
ALTER TABLE donations ADD COLUMN tree_request_id text;
-- Set just before calling Digital Humani. A row that has it but no tree_request_id may have
-- been requested without hearing back, so a retry first asks Digital Humani (ADR 0013).
ALTER TABLE donations ADD COLUMN request_attempted_at timestamptz;
ALTER TABLE donations ADD COLUMN requested_at timestamptz;

ALTER TABLE donations
  ADD CONSTRAINT donations_tree_count_check CHECK (tree_count > 0),
  ADD CONSTRAINT donations_tree_request_id_key UNIQUE (tree_request_id),
  -- Owed or paid means the trees were requested: there's a request ID and a time.
  ADD CONSTRAINT donations_requested_fields_check CHECK (
    status NOT IN ('owed', 'paid')
    OR tree_count IS NULL
    OR (tree_request_id IS NOT NULL AND requested_at IS NOT NULL)
  ),
  -- A tree donation costs exactly $1 per tree.
  ADD CONSTRAINT donations_tree_amount_check CHECK (
    tree_count IS NULL OR donation_amount_cents = tree_count * 100
  );

-- The background retry looks for tree requests that haven't gone through.
CREATE INDEX donations_pending_trees_idx ON donations (id)
  WHERE status = 'pending' AND tree_count IS NOT NULL;

-- Down Migration

DROP INDEX donations_pending_trees_idx;
ALTER TABLE donations
  DROP CONSTRAINT donations_tree_amount_check,
  DROP CONSTRAINT donations_requested_fields_check,
  DROP CONSTRAINT donations_tree_request_id_key,
  DROP CONSTRAINT donations_tree_count_check;
ALTER TABLE donations DROP COLUMN requested_at;
ALTER TABLE donations DROP COLUMN request_attempted_at;
ALTER TABLE donations DROP COLUMN tree_request_id;
ALTER TABLE donations DROP COLUMN tree_count;
