-- Cache for outbound link previews.
--
-- The feed is mostly shared bot/news posts shown to everyone, so the same
-- handful of article URLs are requested thousands of times. Caching collapses
-- those to one outbound fetch per URL; every repeat becomes a cheap PK lookup.
--
-- `success = false` rows cache transient failures briefly (so we retry later)
-- without re-hammering an unreachable site on every scroll.

CREATE TABLE IF NOT EXISTS link_preview_cache (
  url TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  image TEXT,
  site_name TEXT,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_link_preview_cache_fetched_at
  ON link_preview_cache (fetched_at);

COMMENT ON TABLE link_preview_cache IS 'Cached link-preview metadata keyed by source URL to avoid repeated outbound scrapes';
COMMENT ON COLUMN link_preview_cache.success IS 'TRUE if the preview fetch succeeded; FALSE rows are short-lived failure markers';
