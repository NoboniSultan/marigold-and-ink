-- Up Migration

-- Milestone 10 (ADR 0016) starts using the files table. Reference photos and previews are
-- stored as re-encoded JPEGs, and their size lets the page lay them out before they load.
-- Final files that aren't images (PDF) have none.
ALTER TABLE files
  ADD COLUMN width integer,
  ADD COLUMN height integer,
  -- Both sizes or neither (written so a half-filled pair can't pass as "unknown").
  ADD CONSTRAINT files_dimensions_check CHECK (
    (width IS NULL) = (height IS NULL) AND (width IS NULL OR (width > 0 AND height > 0))
  ),
  -- What the original was called, for the download's name; never a path.
  ADD CONSTRAINT files_original_filename_check CHECK (
    original_filename IS NULL OR (length(original_filename) BETWEEN 1 AND 200
      AND original_filename !~ '[/\\]')
  );

-- Down Migration

ALTER TABLE files
  DROP CONSTRAINT files_original_filename_check,
  DROP CONSTRAINT files_dimensions_check,
  DROP COLUMN height,
  DROP COLUMN width;
