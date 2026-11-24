-- Up Migration

-- Whether an artwork appears in Explore's 3D sketchbook. Every published piece is in the
-- grid; the owner picks which ones the book shows, with "sketchbook": false in
-- content/artworks.json (milestone 8b). See docs/data-model.md.
ALTER TABLE artworks ADD COLUMN in_sketchbook boolean NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE artworks DROP COLUMN in_sketchbook;
