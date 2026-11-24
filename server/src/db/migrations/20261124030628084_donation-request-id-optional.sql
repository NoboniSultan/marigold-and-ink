-- Up Migration

-- Digital Humani can count the trees under a reference but can't list its requests (the
-- sandbox answers GET /tree?user= with { count }). So when a retry finds a donation's trees
-- already counted under its commission's reference, the request went through but its ID
-- is unknown. An owed or paid tree donation still needs the time it was requested; the
-- request ID is recorded whenever there is one (ADR 0013, amended).
ALTER TABLE donations DROP CONSTRAINT donations_requested_fields_check;
ALTER TABLE donations ADD CONSTRAINT donations_requested_fields_check CHECK (
  status NOT IN ('owed', 'paid')
  OR tree_count IS NULL
  OR requested_at IS NOT NULL
);

-- Down Migration

-- Fails if any owed or paid tree donation was adopted without a request ID.
ALTER TABLE donations DROP CONSTRAINT donations_requested_fields_check;
ALTER TABLE donations ADD CONSTRAINT donations_requested_fields_check CHECK (
  status NOT IN ('owed', 'paid')
  OR tree_count IS NULL
  OR (tree_request_id IS NOT NULL AND requested_at IS NOT NULL)
);
