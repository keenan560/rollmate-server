-- Training Logs table for tracking training sessions
CREATE TABLE training_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id),
  date TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  training_type TEXT NOT NULL,
  intensity TEXT NOT NULL,
  techniques_practiced TEXT[] DEFAULT '{}',
  sparring_rounds INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  partner_id TEXT REFERENCES users(id),
  gym_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_training_logs_user_date ON training_logs(user_id, date DESC);
