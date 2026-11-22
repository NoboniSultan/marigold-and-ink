-- Up Migration

-- Incoming payments (deposit, final): the Stripe Checkout page the client is sent to, and
-- when it stops working. A second "Pay" click reuses an open page instead of creating
-- another one.
ALTER TABLE payments ADD COLUMN checkout_url text;
ALTER TABLE payments ADD COLUMN checkout_expires_at timestamptz;

-- Refunds: why the money went back, and which admin asked for it. NULL requester = the
-- system (an automatic refund) or a refund made directly in the Stripe Dashboard.
ALTER TABLE payments ADD COLUMN reason text;
ALTER TABLE payments ADD COLUMN requested_by_user_id bigint
  REFERENCES users (id) ON DELETE RESTRICT;

ALTER TABLE payments
  ADD CONSTRAINT payments_checkout_fields_check
    CHECK (type <> 'refund' OR (checkout_url IS NULL AND checkout_expires_at IS NULL)),
  ADD CONSTRAINT payments_refund_fields_check
    CHECK (type = 'refund' OR (reason IS NULL AND requested_by_user_id IS NULL)),
  ADD CONSTRAINT payments_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  ADD CONSTRAINT payments_checkout_url_check CHECK (checkout_url ~ '^https://');

-- Down Migration

ALTER TABLE payments
  DROP CONSTRAINT payments_checkout_url_check,
  DROP CONSTRAINT payments_reason_check,
  DROP CONSTRAINT payments_refund_fields_check,
  DROP CONSTRAINT payments_checkout_fields_check;
ALTER TABLE payments DROP COLUMN requested_by_user_id;
ALTER TABLE payments DROP COLUMN reason;
ALTER TABLE payments DROP COLUMN checkout_expires_at;
ALTER TABLE payments DROP COLUMN checkout_url;
