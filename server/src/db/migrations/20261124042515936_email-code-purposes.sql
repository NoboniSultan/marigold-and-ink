-- Up Migration

-- Emailed 6-digit codes now serve three purposes (milestone 8d, ADR 0014):
--   signup          prove an email before its account is created (as before)
--   password_reset  prove an email to set a new password
--   email_change    prove a new address before an account moves to it
-- Each purpose keeps at most one pending code per address, so the primary key becomes
-- (purpose, email). An email-change code also records whose account it is for.
ALTER TABLE email_verifications
  ADD COLUMN purpose text NOT NULL DEFAULT 'signup',
  ADD COLUMN user_id bigint,
  ADD CONSTRAINT email_verifications_purpose_check
    CHECK (purpose IN ('signup', 'password_reset', 'email_change')),
  -- Only an email change belongs to an account; the others are by address alone.
  ADD CONSTRAINT email_verifications_user_check
    CHECK ((purpose = 'email_change') = (user_id IS NOT NULL)),
  -- A pending code means nothing once its account is gone.
  ADD CONSTRAINT email_verifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE email_verifications DROP CONSTRAINT email_verifications_pkey;
ALTER TABLE email_verifications ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (purpose, email);
ALTER TABLE email_verifications ALTER COLUMN purpose DROP DEFAULT;

-- Account deletion removes a user's pending email change; the foreign key needs it too.
CREATE INDEX email_verifications_user_id_idx ON email_verifications (user_id)
  WHERE user_id IS NOT NULL;
-- Expired codes are deleted whenever a new one is sent.
CREATE INDEX email_verifications_expires_at_idx ON email_verifications (expires_at);

-- Down Migration

DROP INDEX email_verifications_expires_at_idx;
DROP INDEX email_verifications_user_id_idx;
DELETE FROM email_verifications WHERE purpose <> 'signup';
ALTER TABLE email_verifications DROP CONSTRAINT email_verifications_pkey;
ALTER TABLE email_verifications ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (email);
ALTER TABLE email_verifications
  DROP CONSTRAINT email_verifications_user_id_fkey,
  DROP CONSTRAINT email_verifications_user_check,
  DROP CONSTRAINT email_verifications_purpose_check,
  DROP COLUMN user_id,
  DROP COLUMN purpose;
