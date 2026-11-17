-- Up Migration

CREATE TABLE charities (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text        NOT NULL,
  description text,
  website_url text,
  is_active   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT charities_name_key UNIQUE (name),
  CONSTRAINT charities_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT charities_website_url_check CHECK (website_url ~ '^https?://')
);

-- At most one active charity at a time, so "the currently active charity" a new
-- donation is assigned to is never ambiguous. Indexing a constant (true) over only
-- the active rows means a second active row would be a duplicate key.
CREATE UNIQUE INDEX charities_one_active_idx ON charities ((true)) WHERE is_active;

CREATE TRIGGER charities_set_updated_at
  BEFORE UPDATE ON charities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The donation ledger: one row per successful payment.
CREATE TABLE donations (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id            bigint       NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  -- Denormalised from the payment for simpler reporting by commission.
  commission_id         bigint       NOT NULL REFERENCES commissions (id) ON DELETE RESTRICT,
  -- The charity active when the payment succeeded. Never changes if the active charity changes later.
  charity_id            bigint       NOT NULL REFERENCES charities (id) ON DELETE RESTRICT,
  -- Stored per row (not just in config) so past donations keep the rate they were made at.
  percentage            numeric(5,2) NOT NULL,
  -- The item price the percentage applies to (excludes shipping and tax).
  base_amount_cents     integer      NOT NULL,
  donation_amount_cents integer      NOT NULL,
  -- pending:  recorded, not yet confirmed as owed
  -- owed:     confirmed and awaiting payout
  -- paid:     paid out to the charity (payout_date set)
  -- reversed: cancelled by a full refund
  status                text         NOT NULL DEFAULT 'pending',
  payout_date           date,
  receipt_reference     text,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT donations_status_check CHECK (status IN ('pending', 'owed', 'paid', 'reversed')),
  CONSTRAINT donations_percentage_check CHECK (percentage > 0 AND percentage <= 100),
  CONSTRAINT donations_amounts_check CHECK (
    base_amount_cents >= 0 AND donation_amount_cents >= 0 AND donation_amount_cents <= base_amount_cents
  ),
  -- A paid donation must say when it was paid out.
  CONSTRAINT donations_paid_has_payout_date_check CHECK (status <> 'paid' OR payout_date IS NOT NULL),
  -- One donation per payment: a replayed webhook can never create a second donation.
  CONSTRAINT donations_payment_id_key UNIQUE (payment_id)
);

-- Admin filters: by charity, by status, and by month (created_at range).
CREATE INDEX donations_charity_id_idx ON donations (charity_id);
CREATE INDEX donations_status_idx ON donations (status);
CREATE INDEX donations_created_at_idx ON donations (created_at);
CREATE INDEX donations_commission_id_idx ON donations (commission_id);

CREATE TRIGGER donations_set_updated_at
  BEFORE UPDATE ON donations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE donations;
DROP TABLE charities;
