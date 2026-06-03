-- Add recurrence column to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence TEXT DEFAULT 'once';

-- Create event_comments table
-- Note: event_id type must match events.id (UUID in prod, INTEGER in UAT)
CREATE TABLE IF NOT EXISTS event_comments (
  id SERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by event
CREATE INDEX IF NOT EXISTS idx_event_comments_event_id ON event_comments(event_id);

-- Index for user's comments (for deletion auth checks)
CREATE INDEX IF NOT EXISTS idx_event_comments_user_id ON event_comments(user_id);
