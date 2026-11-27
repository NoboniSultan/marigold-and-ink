-- Up Migration

-- Shipped and delivered orders (milestone 12c) were paid first, so they keep their payment
-- like paid and refunded ones.
ALTER TABLE orders DROP CONSTRAINT orders_paid_check;
ALTER TABLE orders ADD CONSTRAINT orders_paid_check CHECK (
  (paid_at IS NULL) = (stripe_payment_intent_id IS NULL)
  AND (status NOT IN ('paid', 'shipped', 'delivered', 'refunded') OR paid_at IS NOT NULL)
);

-- Down Migration

ALTER TABLE orders DROP CONSTRAINT orders_paid_check;
ALTER TABLE orders ADD CONSTRAINT orders_paid_check CHECK (
  (paid_at IS NULL) = (stripe_payment_intent_id IS NULL)
  AND (status NOT IN ('paid', 'refunded') OR paid_at IS NOT NULL)
);
