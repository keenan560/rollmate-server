-- Create get_post_comments function
-- This function returns comments for a specific post with user details

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

-- Verify the function was created
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_name = 'get_post_comments';
