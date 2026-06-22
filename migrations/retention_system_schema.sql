-- Retention System Schema
-- Leaderboard cache, nudge tracking, and supporting indexes

-- Leaderboard cache (optional — refreshed on demand or via cron)
CREATE TABLE IF NOT EXISTS leaderboard_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(20) NOT NULL,  -- sessions, mat_time, sparring_rounds, streak
  period VARCHAR(20) NOT NULL,    -- weekly, monthly, all_time
  value INTEGER NOT NULL DEFAULT 0,
  rank INTEGER NOT NULL DEFAULT 0,
  previous_rank INTEGER,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, category, period)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_cache_rank
  ON leaderboard_cache(category, period, rank);

-- Engagement nudge history (avoid showing same nudge repeatedly)
CREATE TABLE IF NOT EXISTS nudge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  nudge_type VARCHAR(50) NOT NULL,
  shown_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  dismissed BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_nudge_history_user
  ON nudge_history(user_id, nudge_type, shown_at DESC);

-- Performance index for weekly recap aggregation
CREATE INDEX IF NOT EXISTS idx_training_logs_user_date
  ON training_logs(user_id, date DESC);

-- Performance index for leaderboard period queries
CREATE INDEX IF NOT EXISTS idx_training_logs_date_user
  ON training_logs(date, user_id);
