-- Up Migration

-- Labels and tracking for shipped commissions (milestone 11b, ADR 0017).

-- Where a package is, as the shipping service reports it.
CREATE DOMAIN tracking_status AS text
  CONSTRAINT tracking_status_check CHECK (VALUE IN (
    'unknown', 'pre_transit', 'transit', 'delivered', 'returned', 'failure'
  ));

-- The latest prices fetched for buying the label (rates are only valid for a few days, so
-- the label is priced again after the client paid). A label can only be bought from these.
ALTER TABLE shipments ADD COLUMN label_quote_id text;

-- A postage label bought for a shipment. A voided label stays (its refund is tracked), and
-- a new one can then be bought; at most one label per shipment is not voided. The label
-- file itself isn't stored: the shipping service hands out a fresh, expiring link on request.
CREATE TABLE shipping_labels (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id              bigint          NOT NULL REFERENCES shipments (id) ON DELETE RESTRICT,
  provider_transaction_id  text            NOT NULL,
  carrier                  text            NOT NULL,
  service_token            text            NOT NULL,
  service_name             text            NOT NULL,
  tracking_number          text            NOT NULL,
  tracking_url             text,
  -- What the owner paid for the postage (may differ from what the client was charged).
  postage_cents            integer         NOT NULL,

  tracking_status          tracking_status NOT NULL DEFAULT 'unknown',
  tracking_details         text,
  tracking_updated_at      timestamptz,
  eta                      timestamptz,
  -- When the owner was told about a delivery problem (sent once per label).
  problem_notified_at      timestamptz,

  voided_at                timestamptz,
  refund_id                text,
  refund_status            text,

  created_at               timestamptz     NOT NULL DEFAULT now(),
  updated_at               timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT shipping_labels_provider_transaction_id_key UNIQUE (provider_transaction_id),
  CONSTRAINT shipping_labels_postage_cents_check CHECK (postage_cents >= 0),
  CONSTRAINT shipping_labels_text_check CHECK (
    char_length(provider_transaction_id) BETWEEN 1 AND 100
    AND char_length(carrier) BETWEEN 1 AND 50
    AND char_length(service_token) BETWEEN 1 AND 100
    AND char_length(service_name) BETWEEN 1 AND 100
    AND char_length(tracking_number) BETWEEN 1 AND 100
    AND char_length(tracking_details) <= 500
  ),
  CONSTRAINT shipping_labels_tracking_url_check CHECK (tracking_url ~ '^https://'),
  -- A voided label has a refund request, with its status; a label in use has neither.
  CONSTRAINT shipping_labels_refund_check CHECK (
    (voided_at IS NULL) = (refund_id IS NULL)
    AND (voided_at IS NULL) = (refund_status IS NULL)
    AND (refund_status IS NULL OR refund_status IN ('queued', 'pending', 'success', 'error'))
  )
);

-- At most one label in use per shipment.
CREATE UNIQUE INDEX shipping_labels_one_active_idx
  ON shipping_labels (shipment_id) WHERE voided_at IS NULL;
-- Tracking updates arrive by tracking number.
CREATE INDEX shipping_labels_tracking_number_idx ON shipping_labels (tracking_number);

CREATE TRIGGER shipping_labels_set_updated_at
  BEFORE UPDATE ON shipping_labels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The carrier's scans for a label, as reported by the shipping service. Never changed once
-- written; the service's own ID for each scan keeps a repeated update from adding it twice.
CREATE TABLE tracking_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label_id           bigint          NOT NULL REFERENCES shipping_labels (id) ON DELETE RESTRICT,
  provider_event_id  text            NOT NULL,
  status             tracking_status NOT NULL,
  details            text,
  occurred_at        timestamptz,
  -- Where the scan happened (a carrier facility's town), never the delivery address.
  city               text,
  state              text,
  created_at         timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT tracking_events_label_event_key UNIQUE (label_id, provider_event_id),
  CONSTRAINT tracking_events_text_check CHECK (
    char_length(provider_event_id) BETWEEN 1 AND 100
    AND char_length(details) <= 500
    AND char_length(city) <= 100
    AND char_length(state) <= 50
  )
);

-- Down Migration

DROP TABLE tracking_events;
DROP TABLE shipping_labels;
ALTER TABLE shipments DROP COLUMN label_quote_id;
DROP DOMAIN tracking_status;
