-- Up Migration

-- Every money movement for a commission: deposit, final balance, or refund.
-- Amounts are always positive integer cents; the `type` says which direction the money moved.
CREATE TABLE payments (
  id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  commission_id              bigint      NOT NULL REFERENCES commissions (id) ON DELETE RESTRICT,
  type                       text        NOT NULL,
  amount_cents               integer     NOT NULL,
  -- ISO 4217 code as Stripe reports it (lowercase, e.g. 'usd'). Stored per payment so the
  -- record stays unambiguous even if the shop's currency setting ever changes.
  currency                   text        NOT NULL,
  -- pending:   Checkout session created, not paid yet
  -- succeeded: money received (or refund completed)
  -- failed:    payment or refund failed
  -- expired:   Checkout session expired unpaid
  status                     text        NOT NULL DEFAULT 'pending',
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  stripe_refund_id           text,
  -- For refunds: the deposit or final payment being refunded.
  refunded_payment_id        bigint      REFERENCES payments (id) ON DELETE RESTRICT,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payments_type_check CHECK (type IN ('deposit', 'final', 'refund')),
  CONSTRAINT payments_status_check CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
  CONSTRAINT payments_amount_check CHECK (amount_cents > 0),
  CONSTRAINT payments_currency_check CHECK (currency ~ '^[a-z]{3}$'),
  -- A refund must point at the payment it refunds, and only refunds may do so.
  CONSTRAINT payments_refund_link_check CHECK ((type = 'refund') = (refunded_payment_id IS NOT NULL)),
  -- Checkout sessions belong to incoming payments; refund IDs belong to refunds.
  CONSTRAINT payments_stripe_ids_check CHECK (
    CASE type
      WHEN 'refund' THEN stripe_checkout_session_id IS NULL
      ELSE stripe_refund_id IS NULL
    END
  ),
  -- Unique Stripe IDs make webhook handling idempotent at the database level: recording
  -- the same Checkout session or refund twice fails instead of double-counting money.
  CONSTRAINT payments_stripe_checkout_session_id_key UNIQUE (stripe_checkout_session_id),
  CONSTRAINT payments_stripe_refund_id_key UNIQUE (stripe_refund_id)
);

-- A payment intent is unique among incoming payments. Refund rows repeat the intent of
-- the payment they refund, so they are excluded from this index.
CREATE UNIQUE INDEX payments_stripe_payment_intent_id_key
  ON payments (stripe_payment_intent_id) WHERE type <> 'refund';

-- A commission can be successfully paid at most once per stage (one deposit, one final).
-- A last line of defense against double-charging if two webhooks or sessions race.
CREATE UNIQUE INDEX payments_one_succeeded_per_stage_idx
  ON payments (commission_id, type) WHERE type IN ('deposit', 'final') AND status = 'succeeded';

-- All payments for a commission.
CREATE INDEX payments_commission_id_idx ON payments (commission_id);
-- Refunds of a given payment (to compute how much has already been refunded).
CREATE INDEX payments_refunded_payment_id_idx ON payments (refunded_payment_id)
  WHERE refunded_payment_id IS NOT NULL;

CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Stripe may deliver the same webhook event more than once. The handler inserts the
-- event ID here first, inside the same transaction as its side effects; a duplicate
-- delivery hits the UNIQUE constraint and is skipped.
CREATE TABLE processed_webhook_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stripe_event_id text        NOT NULL,
  event_type      text        NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT processed_webhook_events_stripe_event_id_key UNIQUE (stripe_event_id)
);

-- Down Migration

DROP TABLE processed_webhook_events;
DROP TABLE payments;
