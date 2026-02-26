-- Update get_posts_with_details function to include media_urls
-- This ensures the API returns all images for posts with multiple images

-- STEP 1: First, let's check what the current function returns
-- Run this query to see the current function definition:
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'get_posts_with_details';

-- STEP 2: Drop the existing function
DROP FUNCTION IF EXISTS get_posts_with_details(INTEGER, INTEGER, TEXT);

-- STEP 3: Recreate with media_urls added
-- NOTE: Adjust the column types below to match your actual database schema
CREATE OR REPLACE FUNCTION get_posts_with_details(
    p_limit INTEGER DEFAULT 30,
    p_offset INTEGER DEFAULT 0,
    p_current_user_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER,
    user_id TEXT,
    content TEXT,
    media_type TEXT,
    media_url TEXT,
    media_urls TEXT[],              -- NEW: Array of image URLs
    video_thumbnail_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    is_deleted BOOLEAN,
    likes_count BIGINT,
    comments_count BIGINT,
    user_has_liked BOOLEAN,
    user_display_name TEXT,
    user_profile_pic TEXT,
    user_belt_level TEXT,
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
        p.media_urls,                -- NEW: Return the array
        p.video_thumbnail_url,
        p.created_at,
        p.updated_at,
        p.is_deleted,
        COALESCE(likes.count, 0) AS likes_count,
        COALESCE(comments.count, 0) AS comments_count,
        EXISTS(
            SELECT 1 FROM post_likes pl 
            WHERE pl.post_id = p.id 
            AND pl.user_id = p_current_user_id
        ) AS user_has_liked,
        u.display_name AS user_display_name,
        u.profile_pic AS user_profile_pic,
        u.belt_level AS user_belt_level,
        u.belt_verified AS user_belt_verified
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN (
        SELECT post_id, COUNT(*) as count 
        FROM post_likes 
        GROUP BY post_id
    ) likes ON p.id = likes.post_id
    LEFT JOIN (
        SELECT post_id, COUNT(*) as count 
        FROM post_comments 
        GROUP BY post_id
    ) comments ON p.id = comments.post_id
    LEFT JOIN hidden_posts hp ON p.id = hp.post_id AND hp.user_id = p_current_user_id
    WHERE p.is_deleted = false
    AND hp.id IS NULL
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- TROUBLESHOOTING:
-- If you get a type mismatch error, you need to adjust the RETURNS TABLE types
-- to match your actual database column types.
-- 
-- Common fixes:
-- 1. If posts.id is TEXT not INTEGER, change: id INTEGER -> id TEXT
-- 2. If user columns are VARCHAR not TEXT, change: TEXT -> VARCHAR
-- 3. Check your actual column types with:
--    SELECT column_name, data_type FROM information_schema.columns 
--    WHERE table_name = 'posts';
