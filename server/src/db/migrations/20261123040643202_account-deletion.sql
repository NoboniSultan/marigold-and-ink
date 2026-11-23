-- Up Migration

-- Deleting an account anonymizes it instead of removing the row: the client's commissions
-- and payments stay for the owner's accounts (they reference users ON DELETE RESTRICT),
-- but nothing that identifies the person remains (ADR 0012).
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- A live account has an email; a deleted one has no email, password, or verification
-- date. Several deleted rows can share a NULL email: UNIQUE treats NULLs as distinct.
ALTER TABLE users ADD CONSTRAINT users_deleted_fields_check CHECK (
  (deleted_at IS NULL AND email IS NOT NULL)
  OR (deleted_at IS NOT NULL AND email IS NULL AND password_hash IS NULL
      AND email_verified_at IS NULL AND role = 'client')
);

-- Down Migration

-- Deleted rows need an email again before the column can be NOT NULL. A reserved,
-- undeliverable address (RFC 2606 .invalid) keeps them unique and clearly not a person.
ALTER TABLE users DROP CONSTRAINT users_deleted_fields_check;
UPDATE users SET email = 'deleted-' || id || '@deleted.invalid' WHERE email IS NULL;
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
ALTER TABLE users DROP COLUMN deleted_at;
