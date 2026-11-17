-- Up Migration

-- A domain is a named type = base type + CHECK. Defining the allowed fulfillment types
-- once lets pricing_rules and commissions share the same rule, and changing the list
-- later is a single ALTER DOMAIN instead of editing every column's CHECK.
CREATE DOMAIN fulfillment_type AS text
  CONSTRAINT fulfillment_type_check CHECK (VALUE IN ('digital', 'physical', 'mixed_media'));

-- One row per price component. The pricing engine (milestone 4) reads the active rules
-- and adds up the components that apply to a request:
--   base           price for a given size + medium     (size, medium required)
--   extra_subject  price per subject beyond the first  (no key fields)
--   rush           rush service fee                    (no key fields)
--   fulfillment    surcharge per fulfillment type      (fulfillment_type required)
-- The real amounts are seeded in milestone 4 from the owner's price list.
CREATE TABLE pricing_rules (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_type        text        NOT NULL,
  size             text,
  medium           text,
  fulfillment_type fulfillment_type,
  amount_cents     integer     NOT NULL,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pricing_rules_rule_type_check
    CHECK (rule_type IN ('base', 'extra_subject', 'rush', 'fulfillment')),
  CONSTRAINT pricing_rules_amount_check CHECK (amount_cents >= 0),
  -- Each rule type has exactly the key fields it needs and no others, so a rule can
  -- never be ambiguous (e.g. a "rush" rule that is accidentally tied to one size).
  CONSTRAINT pricing_rules_shape_check CHECK (
    CASE rule_type
      WHEN 'base'          THEN size IS NOT NULL AND medium IS NOT NULL AND fulfillment_type IS NULL
      WHEN 'extra_subject' THEN size IS NULL AND medium IS NULL AND fulfillment_type IS NULL
      WHEN 'rush'          THEN size IS NULL AND medium IS NULL AND fulfillment_type IS NULL
      WHEN 'fulfillment'   THEN size IS NULL AND medium IS NULL AND fulfillment_type IS NOT NULL
    END
  )
);

-- At most one ACTIVE rule per key, so the engine can never find two competing prices.
-- NULLS NOT DISTINCT (Postgres 15+) makes NULL key fields count as equal; without it,
-- two active "rush" rules (all keys NULL) would both be allowed. Inactive rules are
-- excluded, so price history can be kept by deactivating old rows.
CREATE UNIQUE INDEX pricing_rules_active_key_idx
  ON pricing_rules (rule_type, size, medium, fulfillment_type) NULLS NOT DISTINCT
  WHERE is_active;

CREATE TRIGGER pricing_rules_set_updated_at
  BEFORE UPDATE ON pricing_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE pricing_rules;
DROP DOMAIN fulfillment_type;
