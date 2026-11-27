-- Up Migration

-- The shop catalog (milestone 12a, ADR 0019): ready-made products, their variants (each with
-- its own price and stock), their photos, and a log of every stock change. The database is
-- the source of truth; the owner manages it from the admin pages.

-- The four categories from the proposal (section 4).
CREATE DOMAIN product_category AS text
  CONSTRAINT product_category_check CHECK (VALUE IN ('jewelry', 'cards', 'stickers', 'upcycled'));

CREATE TABLE products (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug           text             NOT NULL,
  name           text             NOT NULL,
  category       product_category NOT NULL,
  description    text             NOT NULL DEFAULT '',
  materials      text,
  dimensions     text,
  -- One of a kind (a repainted vase): a single variant with a stock of 0 or 1, shown as
  -- "Sold" once sold. Checked by the service, which sees the variants.
  one_of_a_kind  boolean          NOT NULL DEFAULT false,
  -- Shown in the shop. A sold piece stays published (marked sold) until the owner hides it.
  published      boolean          NOT NULL DEFAULT false,
  created_at     timestamptz      NOT NULL DEFAULT now(),
  updated_at     timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT products_slug_key UNIQUE (slug),
  CONSTRAINT products_slug_format_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT products_text_check CHECK (
    length(btrim(name)) BETWEEN 1 AND 120
    AND char_length(slug) <= 120
    AND char_length(description) <= 5000
    AND char_length(materials) BETWEEN 1 AND 500
    AND char_length(dimensions) BETWEEN 1 AND 200
  )
);

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What a customer chooses and buys: "Pack of 5", "Blue", or a product's only option.
-- CASCADE: catalog rows go with their product. Orders (milestone 12b) will reference variants
-- with RESTRICT, so a product that was ever sold can't be deleted, only hidden.
CREATE TABLE product_variants (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id   bigint      NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  price_cents  integer     NOT NULL,
  -- Changed only together with an inventory_movements row (the service does both).
  stock        integer     NOT NULL DEFAULT 0,
  position     integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_variants_product_name_key UNIQUE (product_id, name),
  CONSTRAINT product_variants_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT product_variants_price_cents_check CHECK (price_cents > 0),
  CONSTRAINT product_variants_stock_check CHECK (stock >= 0),
  CONSTRAINT product_variants_position_check CHECK (position >= 0)
);

CREATE INDEX product_variants_product_id_idx ON product_variants (product_id);

CREATE TRIGGER product_variants_set_updated_at
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A product's photos, processed like other uploads (upright, metadata removed) into two WebP
-- sizes in file storage. Keys contain a content hash, so a changed photo gets a new address.
CREATE TABLE product_photos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint      NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  small_key   text        NOT NULL,
  large_key   text        NOT NULL,
  width       integer     NOT NULL,
  height      integer     NOT NULL,
  -- Written by the owner; every photo needs it before the product can be published.
  alt_text    text,
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_photos_small_key_key UNIQUE (small_key),
  CONSTRAINT product_photos_large_key_key UNIQUE (large_key),
  CONSTRAINT product_photos_key_check CHECK (
    small_key ~ '^shop/products/[0-9]+/[a-f0-9]{16}-small\.webp$'
    AND large_key ~ '^shop/products/[0-9]+/[a-f0-9]{16}-large\.webp$'
  ),
  CONSTRAINT product_photos_size_check CHECK (width > 0 AND height > 0),
  CONSTRAINT product_photos_alt_text_check CHECK (length(btrim(alt_text)) BETWEEN 1 AND 300),
  CONSTRAINT product_photos_position_check CHECK (position >= 0)
);

CREATE INDEX product_photos_product_id_idx ON product_photos (product_id);

CREATE TRIGGER product_photos_set_updated_at
  BEFORE UPDATE ON product_photos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Why stock changed. 12a uses restock and adjustment; 12b adds reservation, release, sale.
CREATE DOMAIN inventory_reason AS text
  CONSTRAINT inventory_reason_check CHECK (VALUE IN (
    'restock', 'adjustment', 'reservation', 'release', 'sale'
  ));

-- Every stock change, so counts can always be audited (proposal 6.10). Never changed once
-- written. CASCADE with the variant: only a never-sold variant can be deleted (see above).
CREATE TABLE inventory_movements (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id      bigint           NOT NULL REFERENCES product_variants (id) ON DELETE CASCADE,
  change          integer          NOT NULL,
  stock_after     integer          NOT NULL,
  reason          inventory_reason NOT NULL,
  note            text,
  -- Who made it (the owner); null for the system (12b: checkout).
  actor_user_id   bigint           REFERENCES users (id) ON DELETE RESTRICT,
  created_at      timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT inventory_movements_change_check CHECK (change <> 0),
  CONSTRAINT inventory_movements_stock_after_check CHECK (stock_after >= 0),
  CONSTRAINT inventory_movements_note_check CHECK (length(btrim(note)) BETWEEN 1 AND 300)
);

CREATE INDEX inventory_movements_variant_id_idx ON inventory_movements (variant_id, id);

-- Down Migration

DROP TABLE inventory_movements;
DROP DOMAIN inventory_reason;
DROP TABLE product_photos;
DROP TABLE product_variants;
DROP TABLE products;
DROP DOMAIN product_category;
