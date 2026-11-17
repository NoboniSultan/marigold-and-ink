-- Up Migration

CREATE TABLE artworks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title        text        NOT NULL,
  slug         text        NOT NULL,
  description  text,
  medium       text,
  category     text        NOT NULL,
  image_url    text        NOT NULL,
  is_published boolean     NOT NULL DEFAULT false,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT artworks_slug_key UNIQUE (slug),
  -- URL-safe slugs only: lowercase words joined by single hyphens, e.g. "sunset-over-dhaka".
  CONSTRAINT artworks_slug_format_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT artworks_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT artworks_category_check CHECK (length(btrim(category)) > 0),
  CONSTRAINT artworks_image_url_check CHECK (image_url ~ '^https?://')
);

-- The public gallery only ever lists published artworks in sort order. A partial index
-- covers exactly those rows, so it stays small and unpublished drafts never bloat it.
CREATE INDEX artworks_published_sort_idx ON artworks (sort_order, id) WHERE is_published;
-- Category filter on the public gallery.
CREATE INDEX artworks_published_category_idx ON artworks (category) WHERE is_published;

CREATE TRIGGER artworks_set_updated_at
  BEFORE UPDATE ON artworks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tags (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text        NOT NULL,
  slug       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tags_slug_key UNIQUE (slug),
  CONSTRAINT tags_slug_format_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT tags_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 50)
);

CREATE TRIGGER tags_set_updated_at
  BEFORE UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Many-to-many join. Deleting an artwork or tag removes its links (CASCADE): a link
-- has no meaning without both ends, and there is no financial history here to protect.
CREATE TABLE artwork_tags (
  artwork_id bigint NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
  tag_id     bigint NOT NULL REFERENCES tags (id) ON DELETE CASCADE,

  -- The composite key prevents tagging the same artwork twice and also serves
  -- "tags for this artwork" lookups (artwork_id is its leading column).
  PRIMARY KEY (artwork_id, tag_id)
);

-- "Artworks with this tag" filter: the primary key can't serve it because tag_id is second.
CREATE INDEX artwork_tags_tag_id_idx ON artwork_tags (tag_id);

-- Down Migration

DROP TABLE artwork_tags;
DROP TABLE tags;
DROP TABLE artworks;
