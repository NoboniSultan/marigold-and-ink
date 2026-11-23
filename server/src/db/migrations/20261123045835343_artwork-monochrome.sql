-- Up Migration

-- Black-and-white pieces come first in the gallery grid, and the 3D view mixes them with
-- coloured ones. Measured by `npm run media` (media/manifest.json) unless the content file
-- says otherwise; see docs/data-model.md.
ALTER TABLE artworks ADD COLUMN is_monochrome boolean NOT NULL DEFAULT false;

-- The public gallery's order is now black-and-white first, then the owner's order, so the
-- old (sort_order, id) index is replaced by one that matches it.
DROP INDEX artworks_published_sort_idx;
CREATE INDEX artworks_published_order_idx
  ON artworks (is_monochrome DESC, sort_order, id) WHERE is_published;

-- Down Migration

DROP INDEX artworks_published_order_idx;
CREATE INDEX artworks_published_sort_idx ON artworks (sort_order, id) WHERE is_published;
ALTER TABLE artworks DROP COLUMN is_monochrome;
