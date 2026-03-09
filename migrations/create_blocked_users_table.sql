-- Create blocked_users table for user blocking functionality

CREATE TABLE IF NOT EXISTS blocked_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Ensure a user can't block the same person twice
  UNIQUE(user_id, blocked_user_id),
  
  -- Ensure a user can't block themselves (additional check)
  CHECK (user_id != blocked_user_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_blocked_users_user_id ON blocked_users(user_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked_user_id ON blocked_users(blocked_user_id);

-- Add comment
COMMENT ON TABLE blocked_users IS 'Stores user blocking relationships';
