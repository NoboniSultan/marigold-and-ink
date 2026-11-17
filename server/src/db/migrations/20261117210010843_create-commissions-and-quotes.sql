-- Up Migration

-- The commission lifecycle. Which transitions are allowed is enforced by the state machine
-- in application code (milestone 4); the database only guarantees the value is a real state.
CREATE DOMAIN commission_status AS text
  CONSTRAINT commission_status_check CHECK (VALUE IN (
    'inquiry', 'quoted', 'deposit_paid', 'in_progress', 'revision',
    'awaiting_final_payment', 'ready_to_ship', 'shipped', 'delivered', 'completed',
    'canceled', 'refunded'
  ));

CREATE TABLE commissions (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- RESTRICT: a user with commissions (and therefore payments) can never be deleted
  -- out from under their financial history.
  client_id          bigint            NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  -- Free text, validated against active pricing rules by the service layer, so adding
  -- a new size or medium is a pricing-rule change, not a migration.
  size               text              NOT NULL,
  medium             text              NOT NULL,
  subject_count      integer           NOT NULL,
  fulfillment_type   fulfillment_type  NOT NULL,
  is_rush            boolean           NOT NULL DEFAULT false,
  notes              text,
  status             commission_status NOT NULL DEFAULT 'inquiry',
  revision_count     integer           NOT NULL DEFAULT 0,
  -- No default: the limit is a business value set by the service when the commission is created.
  revision_limit     integer           NOT NULL,
  quoted_total_cents integer,
  deposit_cents      integer,
  balance_cents      integer,
  created_at         timestamptz       NOT NULL DEFAULT now(),
  updated_at         timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT commissions_subject_count_check CHECK (subject_count >= 1),
  CONSTRAINT commissions_size_check CHECK (length(btrim(size)) > 0),
  CONSTRAINT commissions_medium_check CHECK (length(btrim(medium)) > 0),
  CONSTRAINT commissions_revision_count_check
    CHECK (revision_count >= 0 AND revision_limit >= 0 AND revision_count <= revision_limit),
  -- Money is all-or-nothing and must add up: either no quote yet (all NULL), or a
  -- non-negative total that splits exactly into deposit + balance.
  CONSTRAINT commissions_amounts_check CHECK (
    (quoted_total_cents IS NULL AND deposit_cents IS NULL AND balance_cents IS NULL)
    OR (
      quoted_total_cents >= 0 AND deposit_cents >= 0 AND balance_cents >= 0
      AND deposit_cents + balance_cents = quoted_total_cents
    )
  ),
  -- Past the inquiry stage a commission must have a price. Only 'inquiry' and
  -- 'canceled' (canceled before a quote was sent) may have no amounts.
  CONSTRAINT commissions_quoted_amounts_present_check
    CHECK (status IN ('inquiry', 'canceled') OR quoted_total_cents IS NOT NULL),
  -- Digital-only work is never shipped.
  CONSTRAINT commissions_digital_not_shipped_check
    CHECK (fulfillment_type <> 'digital' OR status NOT IN ('ready_to_ship', 'shipped'))
);

-- A client's "my commissions" list, newest first.
CREATE INDEX commissions_client_created_idx ON commissions (client_id, created_at DESC);
-- The admin list filtered by status, newest first.
CREATE INDEX commissions_status_created_idx ON commissions (status, created_at DESC);

CREATE TRIGGER commissions_set_updated_at
  BEFORE UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Append-only audit trail: one row per status change.
CREATE TABLE commission_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  commission_id bigint            NOT NULL REFERENCES commissions (id) ON DELETE RESTRICT,
  -- NULL from_status = the creation event.
  from_status   commission_status,
  to_status     commission_status NOT NULL,
  -- Who triggered it. System actors (e.g. a Stripe webhook) have no user.
  actor_type    text              NOT NULL,
  actor_user_id bigint            REFERENCES users (id) ON DELETE RESTRICT,
  reason        text,
  metadata      jsonb             NOT NULL DEFAULT '{}'::jsonb,
  -- No updated_at: events are never updated.
  created_at    timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT commission_events_actor_type_check CHECK (actor_type IN ('client', 'admin', 'system')),
  -- Client and admin events must name the user; system events must not.
  CONSTRAINT commission_events_actor_user_check
    CHECK ((actor_type = 'system') = (actor_user_id IS NULL)),
  CONSTRAINT commission_events_status_changes_check
    CHECK (from_status IS NULL OR from_status <> to_status),
  CONSTRAINT commission_events_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

-- Event history for one commission, in order.
CREATE INDEX commission_events_commission_created_idx
  ON commission_events (commission_id, created_at, id);

-- Enforce append-only at the database level: an audit trail that can be edited is not
-- an audit trail. (TRUNCATE, used by tests, is a separate statement and is not blocked.)
CREATE FUNCTION reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER commission_events_append_only
  BEFORE UPDATE OR DELETE ON commission_events
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE quotes (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  commission_id         bigint      NOT NULL REFERENCES commissions (id) ON DELETE RESTRICT,
  -- What the pricing engine calculated, kept even if the admin adjusts the price,
  -- so the original calculation is always visible.
  computed_amount_cents integer     NOT NULL,
  adjusted_amount_cents integer,
  adjustment_note       text,
  -- Snapshot of the engine's breakdown at quote time, e.g.
  -- [{"label": "Base: A4 graphite", "amount_cents": 8000}, ...]. A snapshot, because
  -- pricing rules can change after the quote was sent.
  line_items            jsonb       NOT NULL,
  status                text        NOT NULL DEFAULT 'draft',
  sent_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quotes_status_check CHECK (status IN ('draft', 'sent', 'accepted', 'superseded')),
  CONSTRAINT quotes_amounts_check
    CHECK (computed_amount_cents >= 0 AND (adjusted_amount_cents IS NULL OR adjusted_amount_cents >= 0)),
  -- Any manual price change must be explained.
  CONSTRAINT quotes_adjustment_note_check
    CHECK (adjusted_amount_cents IS NULL OR length(btrim(coalesce(adjustment_note, ''))) > 0),
  CONSTRAINT quotes_line_items_check CHECK (jsonb_typeof(line_items) = 'array'),
  -- A quote the client has seen must record when it was sent.
  CONSTRAINT quotes_sent_at_check CHECK (status NOT IN ('sent', 'accepted') OR sent_at IS NOT NULL)
);

-- At most one current (non-superseded) quote per commission. Revising a quote means
-- marking the old one superseded first, so there's never doubt about which price applies.
CREATE UNIQUE INDEX quotes_one_current_per_commission_idx
  ON quotes (commission_id) WHERE status <> 'superseded';
-- All quotes (including superseded) for a commission's history.
CREATE INDEX quotes_commission_id_idx ON quotes (commission_id);

CREATE TRIGGER quotes_set_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE quotes;
DROP TABLE commission_events;
DROP FUNCTION reject_modification();
DROP TABLE commissions;
DROP DOMAIN commission_status;
