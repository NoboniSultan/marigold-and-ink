-- Up Migration

-- Artwork images are now processed by `npm run media` (WebP, metadata stripped) and served
-- by the app from /media, instead of being external URLs. No artworks exist yet in any
-- environment, so the NOT NULL columns are added directly; if rows did exist this would
-- fail loudly rather than invent image data.
ALTER TABLE artworks DROP COLUMN image_url;

ALTER TABLE artworks
  -- Links the row to its entry in media/manifest.json (derived from the source file name).
  ADD COLUMN image_key       text     NOT NULL,
  ADD COLUMN thumb_path      text     NOT NULL,
  ADD COLUMN thumb_width     integer  NOT NULL,
  ADD COLUMN thumb_height    integer  NOT NULL,
  ADD COLUMN large_path      text     NOT NULL,
  ADD COLUMN large_width     integer  NOT NULL,
  ADD COLUMN large_height    integer  NOT NULL,
  ADD COLUMN alt_text        text,
  ADD COLUMN year            smallint,
  -- Attribution for studies and pieces made after another artist's work.
  ADD COLUMN credit          text,
  -- Set for rows that come from content/artworks.json: a hash of the entry last applied.
  -- The seed rewrites a row only when its file entry changes, so admin edits made through
  -- the API survive restarts until the file itself is edited. NULL = created via the API.
  ADD COLUMN content_hash    text,

  ADD CONSTRAINT artworks_image_key_key UNIQUE (image_key),
  ADD CONSTRAINT artworks_image_key_format_check CHECK (image_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Only app-served, processed images: no external URLs, no path traversal.
  ADD CONSTRAINT artworks_thumb_path_check CHECK (thumb_path ~ '^/media/[a-z0-9][a-z0-9/._-]*\.webp$' AND thumb_path NOT LIKE '%..%'),
  ADD CONSTRAINT artworks_large_path_check CHECK (large_path ~ '^/media/[a-z0-9][a-z0-9/._-]*\.webp$' AND large_path NOT LIKE '%..%'),
  ADD CONSTRAINT artworks_image_dimensions_check CHECK (
    thumb_width > 0 AND thumb_height > 0 AND large_width > 0 AND large_height > 0
  ),
  ADD CONSTRAINT artworks_alt_text_check CHECK (length(btrim(alt_text)) BETWEEN 1 AND 300),
  -- Screen-reader users must get a description of anything the public can see.
  ADD CONSTRAINT artworks_published_alt_text_check CHECK (NOT is_published OR alt_text IS NOT NULL),
  -- A sanity range that catches typos like 20219, not a business rule.
  ADD CONSTRAINT artworks_year_check CHECK (year BETWEEN 1900 AND 2100),
  ADD CONSTRAINT artworks_credit_check CHECK (length(btrim(credit)) BETWEEN 1 AND 200),
  ADD CONSTRAINT artworks_content_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$');

-- Full-text search. A generated column is recomputed by Postgres whenever the row changes,
-- so the index can never fall out of date. Weights rank a title match (A) above credit,
-- medium, and category (B), above the description (C). 'english' stems words, so
-- "portraits" matches "portrait".
ALTER TABLE artworks ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', title), 'A') ||
  setweight(to_tsvector('english', coalesce(credit, '') || ' ' || coalesce(medium, '') || ' ' || category), 'B') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'C')
) STORED;

-- GIN indexes each lexeme, so `search_vector @@ query` finds matching rows without a scan.
CREATE INDEX artworks_search_idx ON artworks USING gin (search_vector);

-- Down Migration

DROP INDEX artworks_search_idx;

ALTER TABLE artworks
  DROP COLUMN search_vector,
  DROP COLUMN content_hash,
  DROP COLUMN credit,
  DROP COLUMN year,
  DROP COLUMN alt_text,
  DROP COLUMN large_height,
  DROP COLUMN large_width,
  DROP COLUMN large_path,
  DROP COLUMN thumb_height,
  DROP COLUMN thumb_width,
  DROP COLUMN thumb_path,
  DROP COLUMN image_key;

-- Like the up step, this fails if artworks exist: their processed images have no URL to restore.
ALTER TABLE artworks
  ADD COLUMN image_url text NOT NULL,
  ADD CONSTRAINT artworks_image_url_check CHECK (image_url ~ '^https?://');
