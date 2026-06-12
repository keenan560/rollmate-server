-- Set-based mutual-friend counts.
--
-- For a viewer and a set of listed friend IDs, returns how many friends the
-- viewer shares with EACH listed friend, in a single aggregate query over the
-- accepted-roll-request graph (no per-row / N+1 lookups).
--
-- "Friendship" = an accepted roll_requests row; the graph is undirected so we
-- normalize each accepted request into both (a,b) and (b,a) edges.
--
-- Mutuals exclude:
--   • the viewer (p_viewer_id)
--   • the listed friend itself
--   • the profile owner being viewed (p_exclude_id) — otherwise, when viewing
--     someone's friends list, that person counts as a mutual on every tile
--   • anyone in a blocking relationship with the viewer
--
-- Friends with 0 shared mutuals simply don't appear in the result; the API
-- layer defaults those to 0.

-- Signature changed (added p_exclude_id), so drop the old 2-arg version first.
DROP FUNCTION IF EXISTS get_mutual_friend_counts(text, text[]);

CREATE OR REPLACE FUNCTION get_mutual_friend_counts(
    p_viewer_id TEXT,
    p_friend_ids TEXT[],
    p_exclude_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    friend_id TEXT,
    mutual_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH edges AS (
        SELECT sender_id AS a, receiver_id AS b
        FROM roll_requests
        WHERE status = 'accepted'
        UNION
        SELECT receiver_id AS a, sender_id AS b
        FROM roll_requests
        WHERE status = 'accepted'
    ),
    viewer_friends AS (
        SELECT b AS uid FROM edges WHERE a = p_viewer_id
    ),
    blocked AS (
        SELECT blocked_user_id AS uid FROM blocked_users WHERE user_id = p_viewer_id
        UNION
        SELECT user_id AS uid FROM blocked_users WHERE blocked_user_id = p_viewer_id
    ),
    friend_edges AS (
        SELECT a AS friend_id, b AS uid
        FROM edges
        WHERE a = ANY(p_friend_ids)
    )
    SELECT fe.friend_id, COUNT(DISTINCT fe.uid)::BIGINT AS mutual_count
    FROM friend_edges fe
    JOIN viewer_friends vf ON vf.uid = fe.uid
    WHERE fe.uid <> p_viewer_id
      AND fe.uid <> fe.friend_id
      AND (p_exclude_id IS NULL OR fe.uid <> p_exclude_id)
      AND fe.uid NOT IN (SELECT uid FROM blocked)
    GROUP BY fe.friend_id;
END;
$$ LANGUAGE plpgsql STABLE;
