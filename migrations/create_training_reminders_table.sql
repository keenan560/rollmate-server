-- Training reminders: per-user reminder preferences
CREATE TABLE IF NOT EXISTS training_reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,
  days TEXT[] NOT NULL DEFAULT '{}',        -- e.g. ['mon', 'wed', 'fri']
  reminder_time TEXT NOT NULL DEFAULT '20:00', -- HH:MM format
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE training_reminders ENABLE ROW LEVEL SECURITY;

-- Block direct public access (backend uses service_role_key)
CREATE POLICY "Deny public access" ON training_reminders
  FOR ALL USING (false);

-- Index for cron job lookups
CREATE INDEX idx_training_reminders_enabled ON training_reminders(enabled) WHERE enabled = true;
