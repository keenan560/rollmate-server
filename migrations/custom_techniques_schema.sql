-- Custom "Professor's Pick" techniques table
CREATE TABLE custom_techniques (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id),
  belt TEXT NOT NULL,
  technique_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, belt, technique_id)
);

CREATE INDEX idx_custom_techniques_user ON custom_techniques(user_id, belt);
