-- Create a more efficient function to get posts by specific user
-- This is better than fetching all posts and filtering in the backend

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
    WHERE p.user_id = p_user_id  -- Filter by specific user
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

-- Verify the function was created
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_name = 'get_user_posts_with_details';
