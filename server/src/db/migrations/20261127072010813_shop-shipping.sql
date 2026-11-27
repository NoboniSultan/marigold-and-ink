-- Up Migration

-- Shipping for shop orders (milestone 12c, ADR 0021).

-- The owner's mailers and boxes: inside size and empty weight. An order is packed in the
-- largest packing type among its items. Owner-set values: the table starts empty.
CREATE TABLE packing_types (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text          NOT NULL,
  length_in   numeric(5, 2) NOT NULL,
  width_in    numeric(5, 2) NOT NULL,
  height_in   numeric(5, 2) NOT NULL,
  weight_oz   numeric(7, 2) NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT packing_types_name_key UNIQUE (name),
  CONSTRAINT packing_types_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT packing_types_size_check CHECK (
    length_in > 0 AND width_in > 0 AND height_in > 0
    AND length_in <= 108 AND width_in <= 108 AND height_in <= 108
  ),
  CONSTRAINT packing_types_weight_check CHECK (weight_oz >= 0 AND weight_oz <= 1120)
);

CREATE TRIGGER packing_types_set_updated_at
  BEFORE UPDATE ON packing_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A product ships in a packing type, or is collected locally (large furniture).
-- RESTRICT: a packing type in use can't be deleted.
ALTER TABLE products
  ADD COLUMN packing_type_id bigint REFERENCES packing_types (id) ON DELETE RESTRICT,
  ADD COLUMN pickup_only boolean NOT NULL DEFAULT false;
CREATE INDEX products_packing_type_id_idx ON products (packing_type_id);

-- Each option's packed weight (a pack of five weighs more than one).
ALTER TABLE product_variants
  ADD COLUMN weight_oz numeric(7, 2),
  ADD CONSTRAINT product_variants_weight_oz_check CHECK (weight_oz > 0 AND weight_oz <= 1120);

-- A shipment belongs to a commission or to a shop order, never both.
ALTER TABLE shipments
  ALTER COLUMN commission_id DROP NOT NULL,
  ADD COLUMN order_id bigint REFERENCES orders (id) ON DELETE RESTRICT,
  ADD CONSTRAINT shipments_order_id_key UNIQUE (order_id),
  ADD CONSTRAINT shipments_owner_check CHECK ((commission_id IS NULL) <> (order_id IS NULL));

-- Orders: the shipping charged at checkout (postage and packaging), or local pickup.
ALTER TABLE orders
  ADD COLUMN shipping_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN pickup boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT orders_shipping_cents_check CHECK (
    shipping_cents >= 0 AND (NOT pickup OR shipping_cents = 0)
  );

-- Shipped orders move on like commissions: shipped at the carrier's first scan, delivered
-- on delivery (or when a pickup is collected).
ALTER DOMAIN order_status DROP CONSTRAINT order_status_check;
ALTER DOMAIN order_status ADD CONSTRAINT order_status_check CHECK (VALUE IN (
  'pending_payment', 'paid', 'shipped', 'delivered', 'expired', 'canceled', 'refunded'
));

-- Down Migration

ALTER DOMAIN order_status DROP CONSTRAINT order_status_check;
ALTER DOMAIN order_status ADD CONSTRAINT order_status_check CHECK (VALUE IN (
  'pending_payment', 'paid', 'expired', 'canceled', 'refunded'
));
ALTER TABLE orders
  DROP CONSTRAINT orders_shipping_cents_check,
  DROP COLUMN pickup,
  DROP COLUMN shipping_cents;
ALTER TABLE shipments
  DROP CONSTRAINT shipments_owner_check,
  DROP CONSTRAINT shipments_order_id_key,
  DROP COLUMN order_id,
  ALTER COLUMN commission_id SET NOT NULL;
ALTER TABLE product_variants
  DROP CONSTRAINT product_variants_weight_oz_check,
  DROP COLUMN weight_oz;
DROP INDEX products_packing_type_id_idx;
ALTER TABLE products
  DROP COLUMN pickup_only,
  DROP COLUMN packing_type_id;
DROP TABLE packing_types;
