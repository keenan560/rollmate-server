-- ============================================
-- COMPLETE MIGRATION FOR ALL MULTIPLE IMAGES FEATURES
-- Run this entire file in your Supabase SQL Editor
-- Includes: Posts, Photo Likes, and Chat Messages
-- ============================================

-- ============================================
-- PART 1: POSTS - MULTIPLE IMAGES SUPPORT
-- ============================================

-- Add media_urls column to posts table
ALTER TABLE posts 
ADD COLUMN IF NOT EXISTS media_urls TEXT[];

COMMENT ON COLUMN posts.media_urls IS 'Array of all media URLs when post has multiple images. media_url contains the primary/first image.';

-- ============================================
-- PART 2: PHOTO LIKES - INDIVIDUAL PHOTO LIKES
-- ============================================

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

-- Enable RLS on photo_likes
ALTER TABLE photo_likes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for photo_likes
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

GRANT ALL ON photo_likes TO authenticated;

COMMENT ON TABLE photo_likes IS 'Stores likes for individual photos in multi-image posts';

-- ============================================
-- PART 3: CHAT MESSAGES - MULTIPLE IMAGES
-- ============================================

-- Add image_urls column to chat_messages table
ALTER TABLE chat_messages 
ADD COLUMN IF NOT EXISTS image_urls TEXT[];

COMMENT ON COLUMN chat_messages.image_urls IS 'Array of all image URLs when message has multiple images. image_url contains the primary/first image for backward compatibility.';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_image_urls ON chat_messages USING GIN (image_urls)
WHERE image_urls IS NOT NULL;

-- ============================================
-- PART 4: DATABASE FUNCTIONS
-- ============================================

-- Drop old functions if they exist
DROP FUNCTION IF EXISTS get_posts_with_details(INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS get_post_comments(UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_photo_likes_for_post(UUID, TEXT);
DROP FUNCTION IF EXISTS get_user_posts_with_details(TEXT, TEXT, INTEGER, INTEGER);

-- Function: get_posts_with_details (with media_urls)
CREATE OR REPLACE FUNCTION get_posts_with_details(
    p_limit INTEGER DEFAULT 30,
    p_offset INTEGER DEFAULT 0,
    p_current_user_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    user_id TEXT,
    content TEXT,
    media_type VARCHAR,
    media_url TEXT,
    media_urls TEXT[],
    video_thumbnail_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    is_deleted BOOLEAN,
    likes_count BIGINT,
    comments_count BIGINT,
    user_has_liked BOOLEAN,
    user_first_name TEXT,
    user_last_name TEXT,
    user_avatar_url TEXT,
    user_belt TEXT,
    user_belt_verified BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.user_id,
        p.content,
        p.media_type,
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at,
        p.updated_at,
        p.is_deleted,
        COALESCE(COUNT(DISTINCT pl.id), 0)::BIGINT AS likes_count,
        COALESCE(COUNT(DISTINCT pc.id), 0)::BIGINT AS comments_count,
        EXISTS(
            SELECT 1 FROM post_likes pl2
            WHERE pl2.post_id = p.id 
            AND pl2.user_id = p_current_user_id
        ) AS user_has_liked,
        u.first_name AS user_first_name,
        u.last_name AS user_last_name,
        u.avatar_url AS user_avatar_url,
        u.belt AS user_belt,
        u.belt_verified AS user_belt_verified
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN post_likes pl ON p.id = pl.post_id
    LEFT JOIN post_comments pc ON p.id = pc.post_id AND pc.is_deleted = false
    LEFT JOIN hidden_posts hp ON p.id = hp.post_id AND hp.user_id = p_current_user_id
    WHERE p.is_deleted = false
    AND hp.id IS NULL
    GROUP BY 
        p.id, 
        p.user_id, 
        p.content, 
        p.media_type, 
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at, 
        p.updated_at, 
        p.is_deleted,
        u.first_name,
        u.last_name,
        u.avatar_url,
        u.belt,
        u.belt_verified
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Function: get_post_comments
CREATE OR REPLACE FUNCTION get_post_comments(
    p_post_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    post_id UUID,
    user_id TEXT,
    content TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    is_deleted BOOLEAN,
    user_first_name TEXT,
    user_last_name TEXT,
    user_avatar_url TEXT,
    user_belt TEXT,
    user_belt_verified BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pc.id,
        pc.post_id,
        pc.user_id,
        pc.content,
        pc.created_at,
        pc.updated_at,
        pc.is_deleted,
        u.first_name AS user_first_name,
        u.last_name AS user_last_name,
        u.avatar_url AS user_avatar_url,
        u.belt AS user_belt,
        u.belt_verified AS user_belt_verified
    FROM post_comments pc
    LEFT JOIN users u ON pc.user_id = u.id
    WHERE pc.post_id = p_post_id
    AND pc.is_deleted = false
    ORDER BY pc.created_at ASC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Function: get_user_posts_with_details (filter by specific user)
CREATE OR REPLACE FUNCTION get_user_posts_with_details(
    p_user_id TEXT,
    p_current_user_id TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    user_id TEXT,
    content TEXT,
    media_type VARCHAR,
    media_url TEXT,
    media_urls TEXT[],
    video_thumbnail_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    is_deleted BOOLEAN,
    likes_count BIGINT,
    comments_count BIGINT,
    user_has_liked BOOLEAN,
    user_first_name TEXT,
    user_last_name TEXT,
    user_avatar_url TEXT,
    user_belt TEXT,
    user_belt_verified BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.user_id,
        p.content,
        p.media_type,
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at,
        p.updated_at,
        p.is_deleted,
        COALESCE(COUNT(DISTINCT pl.id), 0)::BIGINT AS likes_count,
        COALESCE(COUNT(DISTINCT pc.id), 0)::BIGINT AS comments_count,
        EXISTS(
            SELECT 1 FROM post_likes pl2
            WHERE pl2.post_id = p.id 
            AND pl2.user_id = p_current_user_id
        ) AS user_has_liked,
        u.first_name AS user_first_name,
        u.last_name AS user_last_name,
        u.avatar_url AS user_avatar_url,
        u.belt AS user_belt,
        u.belt_verified AS user_belt_verified
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN post_likes pl ON p.id = pl.post_id
    LEFT JOIN post_comments pc ON p.id = pc.post_id AND pc.is_deleted = false
    LEFT JOIN hidden_posts hp ON p.id = hp.post_id AND hp.user_id = p_current_user_id
    WHERE p.user_id = p_user_id
    AND p.is_deleted = false
    AND hp.id IS NULL
    GROUP BY 
        p.id, 
        p.user_id, 
        p.content, 
        p.media_type, 
        p.media_url,
        p.media_urls,
        p.video_thumbnail_url,
        p.created_at, 
        p.updated_at, 
        p.is_deleted,
        u.first_name,
        u.last_name,
        u.avatar_url,
        u.belt,
        u.belt_verified
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Function: get_photo_likes_for_post
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

-- ============================================
-- VERIFICATION
-- ============================================

-- Verify all columns were added
SELECT 'Checking columns...' AS status;
SELECT 
    table_name, 
    column_name, 
    data_type 
FROM information_schema.columns 
WHERE (table_name = 'posts' AND column_name = 'media_urls')
   OR (table_name = 'chat_messages' AND column_name = 'image_urls')
ORDER BY table_name, column_name;

-- Verify photo_likes table was created
SELECT 'Checking photo_likes table...' AS status;
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_name = 'photo_likes';

-- Verify all functions were created
SELECT 'Checking functions...' AS status;
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_name IN ('get_posts_with_details', 'get_user_posts_with_details', 'get_post_comments', 'get_photo_likes_for_post')
ORDER BY routine_name;

SELECT 'Migration completed successfully! ✅' AS status;
