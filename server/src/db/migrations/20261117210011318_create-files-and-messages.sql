-- Up Migration

-- Tables only; upload, storage, and messaging endpoints come in a later phase.

-- Metadata for files kept in object storage. The bytes live in storage; this row
-- records what the file is, who uploaded it, and where to find it.
CREATE TABLE files (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  commission_id       bigint      NOT NULL REFERENCES commissions (id) ON DELETE RESTRICT,
  uploaded_by_user_id bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  -- reference: client's reference photo; preview: watermarked work in progress;
  -- final: deliverable, served only through expiring signed URLs.
  kind                text        NOT NULL,
  storage_key         text        NOT NULL,
  original_filename   text,
  content_type        text        NOT NULL,
  size_bytes          bigint      NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT files_kind_check CHECK (kind IN ('reference', 'preview', 'final')),
  CONSTRAINT files_storage_key_key UNIQUE (storage_key),
  CONSTRAINT files_size_check CHECK (size_bytes > 0),
  CONSTRAINT files_content_type_check CHECK (content_type ~ '^[a-z]+/[a-z0-9.+-]+$')
);

-- Files for one commission, optionally filtered by kind.
CREATE INDEX files_commission_kind_idx ON files (commission_id, kind);

CREATE TRIGGER files_set_updated_at
  BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One message thread per commission between the artist and the client.
CREATE TABLE messages (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  commission_id  bigint      NOT NULL REFERENCES commissions (id) ON DELETE RESTRICT,
  sender_user_id bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  body           text        NOT NULL,
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT messages_body_check CHECK (length(btrim(body)) > 0)
);

-- A commission's thread in order.
CREATE INDEX messages_commission_created_idx ON messages (commission_id, created_at, id);

CREATE TRIGGER messages_set_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE messages;
DROP TABLE files;
