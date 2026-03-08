-- Preview duplicate BJJ news posts WITHOUT deleting them
-- Run this first to see what duplicates exist

-- Summary statistics
SELECT 
  'Total Posts' as metric,
  COUNT(*) as count
FROM posts 
WHERE user_id = 'bjj-news-bot'
UNION ALL
SELECT 
  'Unique URLs' as metric,
  COUNT(DISTINCT substring(content from 'Read more: (https?://[^\s\n]+)')) as count
FROM posts 
WHERE user_id = 'bjj-news-bot'
  AND content LIKE '%Read more:%'
UNION ALL
SELECT 
  'Unique Titles' as metric,
  COUNT(DISTINCT split_part(content, E'\n', 1)) as count
FROM posts 
WHERE user_id = 'bjj-news-bot';

-- Show duplicate URLs with counts
SELECT 
  substring(content from 'Read more: (https?://[^\s\n]+)') as article_url,
  COUNT(*) as duplicate_count,
  MIN(created_at) as first_posted,
  MAX(created_at) as last_posted
FROM posts
WHERE user_id = 'bjj-news-bot'
  AND content LIKE '%Read more:%'
GROUP BY substring(content from 'Read more: (https?://[^\s\n]+)')
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, first_posted DESC;

-- Show duplicate titles with counts
SELECT 
  split_part(content, E'\n', 1) as title,
  COUNT(*) as duplicate_count,
  MIN(created_at) as first_posted,
  MAX(created_at) as last_posted
FROM posts
WHERE user_id = 'bjj-news-bot'
  AND split_part(content, E'\n', 1) != ''
GROUP BY split_part(content, E'\n', 1)
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, first_posted DESC;

-- Show specific duplicate posts (with IDs) that would be deleted
WITH ranked_posts AS (
  SELECT 
    id,
    split_part(content, E'\n', 1) as title,
    substring(content from 'Read more: (https?://[^\s\n]+)') as url,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY substring(content from 'Read more: (https?://[^\s\n]+)')
      ORDER BY created_at ASC
    ) as url_rank,
    ROW_NUMBER() OVER (
      PARTITION BY split_part(content, E'\n', 1)
      ORDER BY created_at ASC
    ) as title_rank
  FROM posts
  WHERE user_id = 'bjj-news-bot'
)
SELECT 
  id,
  LEFT(title, 60) as title_preview,
  created_at,
  CASE 
    WHEN url_rank > 1 THEN 'Duplicate URL'
    WHEN title_rank > 1 THEN 'Duplicate Title'
  END as reason
FROM ranked_posts
WHERE url_rank > 1 OR title_rank > 1
ORDER BY created_at DESC
LIMIT 50;
