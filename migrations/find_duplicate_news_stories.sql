-- Find duplicate news stories by analyzing the actual content
-- This looks for posts with very similar titles (first line of content)

-- Show duplicates by title similarity
WITH post_titles AS (
  SELECT 
    id,
    user_id,
    split_part(content, E'\n', 1) as title,
    substring(content from 'Read more: (https?://[^\s\n]+)') as url,
    created_at
  FROM posts
  WHERE user_id = 'bjj-news-bot'
    AND content LIKE '%Read more:%'
),
duplicate_groups AS (
  SELECT 
    title,
    COUNT(*) as count,
    array_agg(id ORDER BY created_at ASC) as post_ids,
    array_agg(url ORDER BY created_at ASC) as urls,
    MIN(created_at) as first_posted,
    MAX(created_at) as last_posted
  FROM post_titles
  GROUP BY title
  HAVING COUNT(*) > 1
)
SELECT 
  title,
  count as duplicate_count,
  post_ids,
  first_posted,
  last_posted
FROM duplicate_groups
ORDER BY count DESC, first_posted DESC;

-- Show total stats
SELECT 
  'Total Posts' as metric,
  COUNT(*) as value
FROM posts WHERE user_id = 'bjj-news-bot'
UNION ALL
SELECT 
  'Unique Titles' as metric,
  COUNT(DISTINCT split_part(content, E'\n', 1)) as value
FROM posts WHERE user_id = 'bjj-news-bot'
UNION ALL
SELECT 
  'Duplicate Stories' as metric,
  COUNT(*) - COUNT(DISTINCT split_part(content, E'\n', 1)) as value
FROM posts WHERE user_id = 'bjj-news-bot';
