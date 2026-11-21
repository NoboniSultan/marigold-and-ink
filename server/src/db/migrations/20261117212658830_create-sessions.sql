-- Up Migration

-- Login sessions for express-session, read and written by the connect-pg-simple store.
-- The column names and types are dictated by that library, which is why this table
-- doesn't follow the id/created_at/updated_at convention. The browser only ever holds
-- the random `sid` in an httpOnly cookie; everything else stays on the server.
CREATE TABLE sessions (
  sid    text        NOT NULL,
  sess   jsonb       NOT NULL,
  expire timestamptz NOT NULL,

  CONSTRAINT sessions_pkey PRIMARY KEY (sid)
);

-- The store's periodic cleanup deletes rows WHERE expire < now(); this keeps it cheap.
CREATE INDEX sessions_expire_idx ON sessions (expire);

-- Down Migration

DROP TABLE sessions;
