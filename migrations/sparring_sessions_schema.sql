-- Sparring Sessions Schema
-- Stores detailed sparring session data with per-round IBJJF scoring

-- Main session table
CREATE TABLE IF NOT EXISTS sparring_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_rounds INTEGER NOT NULL DEFAULT 0,
  total_points_scored INTEGER NOT NULL DEFAULT 0,
  total_points_conceded INTEGER NOT NULL DEFAULT 0,
  total_submissions_by_me INTEGER NOT NULL DEFAULT 0,
  total_submissions_by_them INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-round scoring table
CREATE TABLE IF NOT EXISTS sparring_rounds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sparring_sessions(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  opponent_id TEXT REFERENCES users(id) ON DELETE SET NULL,

  -- My scores (IBJJF points)
  my_takedowns INTEGER NOT NULL DEFAULT 0,   -- +2 each
  my_sweeps INTEGER NOT NULL DEFAULT 0,      -- +2 each
  my_passes INTEGER NOT NULL DEFAULT 0,      -- +3 each
  my_mounts INTEGER NOT NULL DEFAULT 0,      -- +4 each
  my_backs INTEGER NOT NULL DEFAULT 0,       -- +4 each
  my_kobs INTEGER NOT NULL DEFAULT 0,        -- +2 each (knee on belly)

  -- Their scores (IBJJF points)
  their_takedowns INTEGER NOT NULL DEFAULT 0,
  their_sweeps INTEGER NOT NULL DEFAULT 0,
  their_passes INTEGER NOT NULL DEFAULT 0,
  their_mounts INTEGER NOT NULL DEFAULT 0,
  their_backs INTEGER NOT NULL DEFAULT 0,
  their_kobs INTEGER NOT NULL DEFAULT 0,

  -- Computed point totals (stored for quick reads)
  my_points INTEGER NOT NULL DEFAULT 0,
  their_points INTEGER NOT NULL DEFAULT 0,

  -- Submission result (legacy, derived from submissions array)
  result TEXT NOT NULL DEFAULT 'no_sub', -- 'no_sub', 'i_subbed', 'they_subbed'
  submission_type TEXT, -- e.g. 'armbar', 'rear_naked_choke', 'triangle' (legacy single sub)

  -- Submissions array (source of truth) — each entry: {"by": "me"|"them", "type": "armbar"}
  submissions JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(session_id, round_number)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sparring_sessions_user_id ON sparring_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sparring_sessions_date ON sparring_sessions(session_date DESC);
CREATE INDEX IF NOT EXISTS idx_sparring_rounds_session_id ON sparring_rounds(session_id);
CREATE INDEX IF NOT EXISTS idx_sparring_rounds_opponent_id ON sparring_rounds(opponent_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_sparring_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sparring_sessions_updated_at
  BEFORE UPDATE ON sparring_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_sparring_session_updated_at();

-- RLS policies (if using Supabase RLS)
ALTER TABLE sparring_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sparring_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own sparring sessions"
  ON sparring_sessions FOR ALL
  USING (user_id = auth.uid()::text);

CREATE POLICY "Users can manage rounds in their sessions"
  ON sparring_rounds FOR ALL
  USING (
    session_id IN (
      SELECT id FROM sparring_sessions WHERE user_id = auth.uid()::text
    )
  );

-- Grant service_role full access (for backend API)
GRANT ALL ON sparring_sessions TO service_role;
GRANT ALL ON sparring_rounds TO service_role;
