-- Leaderboard aggregation RPC function
-- This provides efficient server-side aggregation for leaderboard scores.
-- The backend has a JS fallback that works without this function,
-- but deploying this to Supabase will improve performance significantly.

CREATE OR REPLACE FUNCTION get_leaderboard_scores(
  p_category TEXT,
  p_period_start DATE DEFAULT NULL,
  p_user_ids TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  user_id TEXT,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  belt TEXT,
  score BIGINT,
  rank BIGINT,
  is_private BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH log_scores AS (
    SELECT
      tl.user_id AS uid,
      CASE p_category
        WHEN 'sessions' THEN COUNT(*)
        WHEN 'mat_time' THEN COALESCE(SUM(tl.duration_minutes), 0)
        WHEN 'sparring_rounds' THEN COALESCE(SUM(tl.sparring_rounds), 0)
        ELSE COUNT(*)
      END AS raw_score
    FROM training_logs tl
    WHERE
      (p_period_start IS NULL OR tl.date >= p_period_start)
      AND (p_user_ids IS NULL OR tl.user_id = ANY(p_user_ids))
    GROUP BY tl.user_id
    HAVING
      CASE p_category
        WHEN 'sessions' THEN COUNT(*) > 0
        WHEN 'mat_time' THEN COALESCE(SUM(tl.duration_minutes), 0) > 0
        WHEN 'sparring_rounds' THEN COALESCE(SUM(tl.sparring_rounds), 0) > 0
        ELSE COUNT(*) > 0
      END
  )
  SELECT
    u.id AS user_id,
    u.first_name,
    u.last_name,
    u.avatar_url,
    u.belt,
    ls.raw_score AS score,
    ROW_NUMBER() OVER (ORDER BY ls.raw_score DESC) AS rank,
    COALESCE(u.is_private, false) AS is_private
  FROM log_scores ls
  JOIN users u ON u.id = ls.uid
  ORDER BY ls.raw_score DESC
  LIMIT 100;
END;
$$;

-- Grant execute permission to the authenticated role
GRANT EXECUTE ON FUNCTION get_leaderboard_scores(TEXT, DATE, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_leaderboard_scores(TEXT, DATE, TEXT[]) TO service_role;
