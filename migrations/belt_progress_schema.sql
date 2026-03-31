-- Belt progression tracking table
CREATE TABLE belt_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id),
  belt TEXT NOT NULL,
  technique_id TEXT NOT NULL,
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, belt, technique_id)
);

CREATE INDEX idx_belt_progress_user ON belt_progress(user_id, belt);
