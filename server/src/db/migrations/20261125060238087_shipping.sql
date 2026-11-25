-- Up Migration

-- Shipping for physical commissions (milestone 11a, ADR 0017). One shipment per
-- commission: where it goes, the package, and the shipping option the client chose.
-- Labels and tracking come in milestone 11b.
CREATE TABLE shipments (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  commission_id        bigint      NOT NULL REFERENCES commissions (id) ON DELETE RESTRICT,

  -- Where it goes (United States only). If the client deletes their account, the name
  -- and street are removed (address_removed_at); city, state, and ZIP stay for records.
  recipient_name       text,
  address_line1        text,
  address_line2        text,
  city                 text,
  state                text,
  postal_code          text,
  country              text        NOT NULL DEFAULT 'US',
  address_removed_at   timestamptz,

  -- The package, entered by the owner: ounces and inches.
  weight_oz            numeric(7, 2),
  length_in            numeric(5, 2),
  width_in             numeric(5, 2),
  height_in            numeric(5, 2),

  -- The shipping service's quote for this address and package; its rates belong to it.
  provider_shipment_id text,

  -- The option the client chose. Prices come from the shipping service, never a request.
  rate_id              text,
  carrier              text,
  service_token        text,
  service_name         text,
  estimated_days       integer,
  postage_cents        integer,
  packaging_fee_cents  integer,
  rate_chosen_at       timestamptz,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shipments_commission_id_key UNIQUE (commission_id),
  CONSTRAINT shipments_country_check CHECK (country = 'US'),
  CONSTRAINT shipments_state_check CHECK (state ~ '^[A-Z]{2}$'),
  CONSTRAINT shipments_postal_code_check CHECK (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  CONSTRAINT shipments_address_text_check CHECK (
    char_length(recipient_name) BETWEEN 1 AND 100
    AND char_length(address_line1) BETWEEN 1 AND 100
    AND char_length(address_line2) BETWEEN 1 AND 100
    AND char_length(city) BETWEEN 1 AND 60
  ),
  -- City, state, and ZIP come together.
  CONSTRAINT shipments_locality_check CHECK (
    (city IS NULL) = (state IS NULL) AND (city IS NULL) = (postal_code IS NULL)
  ),
  -- A full address has a name, a first line, and a locality; a removed one keeps only
  -- the locality.
  CONSTRAINT shipments_address_check CHECK (
    (recipient_name IS NULL) = (address_line1 IS NULL)
    AND (address_line2 IS NULL OR address_line1 IS NOT NULL)
    AND CASE
      WHEN address_removed_at IS NULL THEN (address_line1 IS NULL) = (city IS NULL)
      ELSE address_line1 IS NULL
    END
  ),
  CONSTRAINT shipments_parcel_check CHECK (
    (weight_oz IS NULL) = (length_in IS NULL)
    AND (weight_oz IS NULL) = (width_in IS NULL)
    AND (weight_oz IS NULL) = (height_in IS NULL)
    AND (weight_oz IS NULL OR (weight_oz > 0 AND length_in > 0 AND width_in > 0 AND height_in > 0))
  ),
  -- A chosen option is complete, and needs the address (or its removal after an account
-- was deleted), the package, and the quote it came from.
  CONSTRAINT shipments_rate_check CHECK (
    (rate_id IS NULL) = (carrier IS NULL)
    AND (rate_id IS NULL) = (service_token IS NULL)
    AND (rate_id IS NULL) = (service_name IS NULL)
    AND (rate_id IS NULL) = (postage_cents IS NULL)
    AND (rate_id IS NULL) = (packaging_fee_cents IS NULL)
    AND (rate_id IS NULL) = (rate_chosen_at IS NULL)
    AND (estimated_days IS NULL OR rate_id IS NOT NULL)
    AND (
      rate_id IS NULL
      OR (
        provider_shipment_id IS NOT NULL
        AND weight_oz IS NOT NULL
        AND (address_line1 IS NOT NULL OR address_removed_at IS NOT NULL)
      )
    )
  ),
  CONSTRAINT shipments_rate_amounts_check CHECK (
    postage_cents >= 0 AND packaging_fee_cents >= 0 AND estimated_days >= 0
  )
);

CREATE TRIGGER shipments_set_updated_at
  BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The part of a final payment that paid for shipping and packaging (not counted toward
-- the tree donation, and reported separately).
ALTER TABLE payments
  ADD COLUMN shipping_cents integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT payments_shipping_cents_check CHECK (
    shipping_cents >= 0 AND shipping_cents <= amount_cents AND (type = 'final' OR shipping_cents = 0)
  );

-- Down Migration

ALTER TABLE payments
  DROP CONSTRAINT payments_shipping_cents_check,
  DROP COLUMN shipping_cents;
DROP TABLE shipments;
