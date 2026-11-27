-- Up Migration

-- Shop orders (milestone 12b, ADR 0020): a cart is checked out into an order, its stock is
-- held while the customer pays in full on Stripe's page, and the order is then paid, or
-- expires (the stock goes back on sale). Paid orders can be refunded in full.

CREATE DOMAIN order_status AS text
  CONSTRAINT order_status_check CHECK (VALUE IN (
    'pending_payment', 'paid', 'expired', 'canceled', 'refunded'
  ));

CREATE TABLE orders (
  id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- RESTRICT: an order is money history; a deleted account is anonymized, never removed.
  client_id                   bigint       NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status                      order_status NOT NULL DEFAULT 'pending_payment',
  -- The items' total, from the prices when the order was made (never from a request).
  subtotal_cents              integer      NOT NULL,
  currency                    text         NOT NULL,
  stripe_checkout_session_id  text,
  checkout_url                text,
  checkout_expires_at         timestamptz,
  stripe_payment_intent_id    text,
  paid_at                     timestamptz,
  created_at                  timestamptz  NOT NULL DEFAULT now(),
  updated_at                  timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT orders_subtotal_cents_check CHECK (subtotal_cents > 0),
  CONSTRAINT orders_currency_check CHECK (currency ~ '^[a-z]{3}$'),
  CONSTRAINT orders_stripe_checkout_session_id_key UNIQUE (stripe_checkout_session_id),
  CONSTRAINT orders_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id),
  CONSTRAINT orders_checkout_url_check CHECK (checkout_url ~ '^https://'),
  -- The Stripe page comes as a whole: its ID, link, and expiry.
  CONSTRAINT orders_checkout_check CHECK (
    (stripe_checkout_session_id IS NULL) = (checkout_url IS NULL)
    AND (stripe_checkout_session_id IS NULL) = (checkout_expires_at IS NULL)
  ),
  -- Paid (and later refunded) orders record when, and the payment Stripe made.
  CONSTRAINT orders_paid_check CHECK (
    (paid_at IS NULL) = (stripe_payment_intent_id IS NULL)
    AND (status NOT IN ('paid', 'refunded') OR paid_at IS NOT NULL)
  )
);

CREATE INDEX orders_client_id_idx ON orders (client_id, id DESC);
-- The release sweep looks for pending orders whose Stripe page has expired.
CREATE INDEX orders_pending_idx ON orders (checkout_expires_at) WHERE status = 'pending_payment';

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What was ordered, with the names and price as they were (the catalog may change later).
-- RESTRICT on the variant: a product that was ever ordered can't be deleted, only hidden.
CREATE TABLE order_items (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id          bigint      NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  variant_id        bigint      NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  product_name      text        NOT NULL,
  variant_name      text        NOT NULL,
  unit_price_cents  integer     NOT NULL,
  quantity          integer     NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_items_order_variant_key UNIQUE (order_id, variant_id),
  CONSTRAINT order_items_unit_price_cents_check CHECK (unit_price_cents > 0),
  CONSTRAINT order_items_quantity_check CHECK (quantity BETWEEN 1 AND 100),
  CONSTRAINT order_items_text_check CHECK (
    length(btrim(product_name)) BETWEEN 1 AND 120 AND length(btrim(variant_name)) BETWEEN 1 AND 80
  )
);

CREATE INDEX order_items_variant_id_idx ON order_items (variant_id);

-- Each status change, like commission_events: who, from what, to what, and why.
CREATE TABLE order_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id       bigint       NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  from_status    order_status NOT NULL,
  to_status      order_status NOT NULL,
  actor_type     text         NOT NULL,
  actor_user_id  bigint       REFERENCES users (id) ON DELETE RESTRICT,
  reason         text,
  created_at     timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT order_events_actor_check CHECK (
    actor_type IN ('client', 'admin', 'system')
    AND (actor_type = 'system') = (actor_user_id IS NULL)
  ),
  CONSTRAINT order_events_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 500)
);

CREATE INDEX order_events_order_id_idx ON order_events (order_id, id);

-- Money given back for an order: by the admin (in full, optionally putting the items back
-- in stock), or a refund made in the Stripe Dashboard.
CREATE TABLE order_refunds (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id              bigint      NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  amount_cents          integer     NOT NULL,
  status                text        NOT NULL DEFAULT 'pending',
  stripe_refund_id      text,
  reason                text        NOT NULL,
  -- Put the items back on sale once the refund succeeds; restocked_at says it was done.
  restock               boolean     NOT NULL DEFAULT false,
  restocked_at          timestamptz,
  requested_by_user_id  bigint      REFERENCES users (id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_refunds_amount_cents_check CHECK (amount_cents > 0),
  CONSTRAINT order_refunds_status_check CHECK (status IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT order_refunds_stripe_refund_id_key UNIQUE (stripe_refund_id),
  CONSTRAINT order_refunds_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT order_refunds_restocked_check CHECK (restocked_at IS NULL OR (restock AND status = 'succeeded'))
);

CREATE INDEX order_refunds_order_id_idx ON order_refunds (order_id);

CREATE TRIGGER order_refunds_set_updated_at
  BEFORE UPDATE ON order_refunds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Stock held for an order, released when it expires, and returned when it's refunded are
-- logged against the order. A paid order changes nothing more (its hold already took the
-- stock), so 'sale' becomes 'return' (items put back after a refund).
ALTER TABLE inventory_movements
  ADD COLUMN order_id bigint REFERENCES orders (id) ON DELETE RESTRICT;
CREATE INDEX inventory_movements_order_id_idx ON inventory_movements (order_id);
ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_order_check CHECK (
    (reason IN ('reservation', 'release', 'return')) = (order_id IS NOT NULL)
  );
ALTER DOMAIN inventory_reason DROP CONSTRAINT inventory_reason_check;
ALTER DOMAIN inventory_reason ADD CONSTRAINT inventory_reason_check CHECK (VALUE IN (
  'restock', 'adjustment', 'reservation', 'release', 'return'
));

-- Down Migration

ALTER DOMAIN inventory_reason DROP CONSTRAINT inventory_reason_check;
ALTER DOMAIN inventory_reason ADD CONSTRAINT inventory_reason_check CHECK (VALUE IN (
  'restock', 'adjustment', 'reservation', 'release', 'sale'
));
ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_order_check;
DROP INDEX inventory_movements_order_id_idx;
ALTER TABLE inventory_movements DROP COLUMN order_id;
DROP TABLE order_refunds;
DROP TABLE order_events;
DROP TABLE order_items;
DROP TABLE orders;
DROP DOMAIN order_status;
