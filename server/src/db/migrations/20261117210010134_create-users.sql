-- Up Migration

-- citext = case-insensitive text. A citext column compares 'Ana@X.com' and 'ana@x.com'
-- as equal, so a plain UNIQUE constraint makes email unique regardless of case.
CREATE EXTENSION IF NOT EXISTS citext;

-- Shared trigger function: every table with updated_at gets a BEFORE UPDATE trigger
-- that calls this, so application code never has to remember to set it.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         citext      NOT NULL,
  password_hash text        NOT NULL,
  display_name  text        NOT NULL,
  role          text        NOT NULL DEFAULT 'client',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_email_key UNIQUE (email),
  -- Light sanity check only (something@something, max 254 chars per RFC 5321);
  -- full validation happens in the zod schema.
  CONSTRAINT users_email_format_check CHECK (email ~ '^[^@\s]+@[^@\s]+$' AND length(email) <= 254),
  CONSTRAINT users_display_name_check CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  CONSTRAINT users_role_check CHECK (role IN ('client', 'admin'))
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE users;
DROP FUNCTION set_updated_at();
DROP EXTENSION IF EXISTS citext;
