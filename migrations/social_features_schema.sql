-- Schema additions for: post likers list (#4) and chat message edit (#6)

-- ── Post likes: timestamp for "who liked, most recent first" ────────────────
-- Adds created_at if missing. Postgres backfills existing rows with the
-- migration-time timestamp (fine for ordering); new likes get their own time.
ALTER TABLE post_likes
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_post_likes_post_id_created_at
  ON post_likes (post_id, created_at DESC);

-- ── Chat messages: edit support ─────────────────────────────────────────────
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS is_edited BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN chat_messages.is_edited IS 'TRUE once the sender has edited the message text';
COMMENT ON COLUMN chat_messages.edited_at IS 'Timestamp of the most recent edit, NULL if never edited';
