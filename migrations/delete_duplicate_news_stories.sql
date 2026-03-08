-- Delete duplicate news stories, keeping only the oldest post for each unique title
-- This handles cases where the same story is posted from multiple RSS sources

BEGIN;

-- Show what will be deleted
WITH post_titles AS (
  SELECT 
    id,
    split_part(content, E'\n', 1) as title,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY split_part(content, E'\n', 1)
      ORDER BY created_at ASC
    ) as rn
  FROM posts
  WHERE user_id = 'bjj-news-bot'
),
to_delete AS (
  SELECT id, title, created_at
  FROM post_titles
  WHERE rn > 1
)
SELECT 
  COUNT(*) as total_duplicates_to_delete,
  MIN(created_at) as oldest_duplicate,
  MAX(created_at) as newest_duplicate
FROM to_delete;

-- Delete the duplicates (keep the first/oldest post for each title)
WITH post_titles AS (
  SELECT 
    id,
    split_part(content, E'\n', 1) as title,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY split_part(content, E'\n', 1)
      ORDER BY created_at ASC
    ) as rn
  FROM posts
  WHERE user_id = 'bjj-news-bot'
)
DELETE FROM posts
WHERE id IN (
  SELECT id 
  FROM post_titles 
  WHERE rn > 1
);

-- Show results
SELECT 
  'Remaining Posts' as metric,
  COUNT(*) as value
FROM posts WHERE user_id = 'bjj-news-bot'
UNION ALL
SELECT 
  'Unique Titles' as metric,
  COUNT(DISTINCT split_part(content, E'\n', 1)) as value
FROM posts WHERE user_id = 'bjj-news-bot';

COMMIT;
