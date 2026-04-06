-- Events feature schema
-- Run this migration in Supabase SQL Editor

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  event_type TEXT NOT NULL, -- 'open_mat', 'seminar', 'meetup', 'tournament', 'other'
  event_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  location_name TEXT NOT NULL,
  location_address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  external_link TEXT,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_events_location ON events(latitude, longitude) WHERE is_deleted = false;

-- Event RSVPs table
CREATE TABLE IF NOT EXISTS event_rsvps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON event_rsvps(event_id);
