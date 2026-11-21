-- Up Migration

-- Accent-insensitive search: "guayasamin" should find "after Oswaldo Guayasamín", and the
-- reverse. The `unaccent` dictionary strips accents before the English stemmer runs. It
-- lives in a custom text search configuration, used both when building search_vector and
-- when parsing the query, so both sides are normalized the same way.
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TEXT SEARCH CONFIGURATION english_unaccent (COPY = english);
ALTER TEXT SEARCH CONFIGURATION english_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, english_stem;

-- A generated column's expression can't be altered in place, so rebuild it (and its index).
DROP INDEX artworks_search_idx;
ALTER TABLE artworks DROP COLUMN search_vector;
ALTER TABLE artworks ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english_unaccent', title), 'A') ||
  setweight(to_tsvector('english_unaccent', coalesce(credit, '') || ' ' || coalesce(medium, '') || ' ' || category), 'B') ||
  setweight(to_tsvector('english_unaccent', coalesce(description, '')), 'C')
) STORED;
CREATE INDEX artworks_search_idx ON artworks USING gin (search_vector);

-- Down Migration

DROP INDEX artworks_search_idx;
ALTER TABLE artworks DROP COLUMN search_vector;
ALTER TABLE artworks ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', title), 'A') ||
  setweight(to_tsvector('english', coalesce(credit, '') || ' ' || coalesce(medium, '') || ' ' || category), 'B') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'C')
) STORED;
CREATE INDEX artworks_search_idx ON artworks USING gin (search_vector);

DROP TEXT SEARCH CONFIGURATION english_unaccent;
DROP EXTENSION unaccent;
