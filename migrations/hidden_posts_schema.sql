-- Create hidden_posts table
CREATE TABLE IF NOT EXISTS hidden_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_hidden_posts_user_id ON hidden_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_hidden_posts_post_id ON hidden_posts(post_id);

-- Add comments to table
COMMENT ON TABLE hidden_posts IS 'Stores posts that users have hidden from their feed';
COMMENT ON COLUMN hidden_posts.post_id IS 'ID of the hidden post';
COMMENT ON COLUMN hidden_posts.user_id IS 'ID of the user who hid the post';
