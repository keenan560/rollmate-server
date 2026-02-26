-- Photo Likes Schema
-- Allows users to like individual photos in multi-image posts

-- Create photo_likes table
CREATE TABLE IF NOT EXISTS photo_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    photo_index INTEGER NOT NULL CHECK (photo_index >= 0),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(post_id, photo_index, user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_photo_likes_post_id ON photo_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_photo_likes_user_id ON photo_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_photo_likes_post_photo ON photo_likes(post_id, photo_index);

-- Function to get photo likes for a post with user's like status
CREATE OR REPLACE FUNCTION get_photo_likes_for_post(
    p_post_id UUID,
    p_user_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    photo_index INTEGER,
    likes_count BIGINT,
    is_liked_by_user BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pl.photo_index,
        COUNT(*)::BIGINT AS likes_count,
        BOOL_OR(pl.user_id = p_user_id) AS is_liked_by_user
    FROM photo_likes pl
    WHERE pl.post_id = p_post_id
    GROUP BY pl.photo_index
    ORDER BY pl.photo_index;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE photo_likes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view all photo likes" ON photo_likes;
CREATE POLICY "Users can view all photo likes"
ON photo_likes FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Users can like photos" ON photo_likes;
CREATE POLICY "Users can like photos"
ON photo_likes FOR INSERT
TO authenticated
WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can unlike their own photo likes" ON photo_likes;
CREATE POLICY "Users can unlike their own photo likes"
ON photo_likes FOR DELETE
TO authenticated
USING (auth.uid()::text = user_id);

-- Grant permissions
GRANT ALL ON photo_likes TO authenticated;

-- Add comment
COMMENT ON TABLE photo_likes IS 'Stores likes for individual photos in multi-image posts';
