-- Up Migration

-- Accounts created with Google have no password.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- When the owner of the email proved it (a code from our email, or Google's verified email).
-- NULL = never verified: only accounts created before this migration. They can't log in
-- until they claim the account by signing up again with an emailed code.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- The admin account is the owner's own, seeded from ADMIN_EMAIL.
UPDATE users SET email_verified_at = created_at WHERE role = 'admin';

-- Sign-in methods other than a password: which external account belongs to which user.
CREATE TABLE auth_identities (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- A sign-in method means nothing without its user, and holds no money or history.
  user_id          bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider         text        NOT NULL,
  -- The provider's permanent ID for the person (Google's `sub`). Emails can change; this can't.
  provider_user_id text        NOT NULL,
  -- The email the provider reported when the identity was linked, for reference only.
  email            citext,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT auth_identities_provider_check CHECK (provider IN ('google')),
  CONSTRAINT auth_identities_provider_user_id_check CHECK (length(provider_user_id) BETWEEN 1 AND 255),
  -- One Google account signs in to exactly one user...
  CONSTRAINT auth_identities_provider_user_key UNIQUE (provider, provider_user_id),
  -- ...and a user links at most one account per provider.
  CONSTRAINT auth_identities_user_provider_key UNIQUE (user_id, provider)
);

CREATE TRIGGER auth_identities_set_updated_at
  BEFORE UPDATE ON auth_identities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sign-up codes waiting to be entered: at most one per email (a new code replaces the old).
-- Only a keyed hash of the code is stored, so a database leak doesn't reveal live codes.
CREATE TABLE email_verifications (
  email      citext      PRIMARY KEY,
  code_hash  text        NOT NULL,
  attempts   smallint    NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  -- When the last email went out, for the resend cooldown.
  sent_at    timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_verifications_code_hash_check CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT email_verifications_attempts_check CHECK (attempts >= 0)
);

CREATE TRIGGER email_verifications_set_updated_at
  BEFORE UPDATE ON email_verifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE email_verifications;
DROP TABLE auth_identities;
ALTER TABLE users DROP COLUMN email_verified_at;
-- Fails if password-less (Google-only) accounts exist: they would have no way to log in.
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
