-- Cleanup duplicate BJJ news posts
-- This script identifies and removes duplicate posts based on URL and title

-- First, let's see what we're dealing with
-- Uncomment to preview duplicates before deleting:
-- SELECT 
--   COUNT(*) as total_posts,
--   COUNT(DISTINCT substring(content from 'Read more: (https?://[^\s\n]+)')) as unique_urls
-- FROM posts 
-- WHERE user_id = 'bjj-news-bot';

-- Create a temporary table to identify duplicates by URL
CREATE TEMP TABLE duplicate_posts_by_url AS
WITH ranked_posts AS (
  SELECT 
    id,
    content,
    created_at,
    substring(content from 'Read more: (https?://[^\s\n]+)') as article_url,
    ROW_NUMBER() OVER (
      PARTITION BY substring(content from 'Read more: (https?://[^\s\n]+)')
      ORDER BY created_at ASC  -- Keep the oldest post
    ) as rn
  FROM posts
  WHERE user_id = 'bjj-news-bot'
    AND content LIKE '%Read more:%'
)
SELECT id, article_url, created_at
FROM ranked_posts
WHERE rn > 1;  -- These are duplicates (keep rn = 1)

-- Create a temporary table to identify duplicates by title
CREATE TEMP TABLE duplicate_posts_by_title AS
WITH ranked_posts AS (
  SELECT 
    id,
    content,
    created_at,
    split_part(content, E'\n', 1) as title,  -- First line is the title
    ROW_NUMBER() OVER (
      PARTITION BY split_part(content, E'\n', 1)
      ORDER BY created_at ASC  -- Keep the oldest post
    ) as rn
  FROM posts
  WHERE user_id = 'bjj-news-bot'
    AND split_part(content, E'\n', 1) != ''
)
SELECT id, title, created_at
FROM ranked_posts
WHERE rn > 1;  -- These are duplicates

-- Show summary of what will be deleted
SELECT 
  'Duplicates by URL' as type,
  COUNT(*) as count
FROM duplicate_posts_by_url
UNION ALL
SELECT 
  'Duplicates by Title' as type,
  COUNT(*) as count
FROM duplicate_posts_by_title
UNION ALL
SELECT 
  'Total Unique Duplicates' as type,
  COUNT(DISTINCT id) as count
FROM (
  SELECT id FROM duplicate_posts_by_url
  UNION
  SELECT id FROM duplicate_posts_by_title
) combined;

-- Delete duplicates by URL
DELETE FROM posts
WHERE id IN (SELECT id FROM duplicate_posts_by_url);

-- Delete duplicates by Title (that weren't already deleted)
DELETE FROM posts
WHERE id IN (SELECT id FROM duplicate_posts_by_title)
  AND id NOT IN (SELECT id FROM duplicate_posts_by_url);

-- Show final summary
SELECT 
  COUNT(*) as remaining_posts,
  COUNT(DISTINCT substring(content from 'Read more: (https?://[^\s\n]+)')) as unique_urls,
  COUNT(DISTINCT split_part(content, E'\n', 1)) as unique_titles
FROM posts 
WHERE user_id = 'bjj-news-bot';

-- Drop temporary tables
DROP TABLE IF EXISTS duplicate_posts_by_url;
DROP TABLE IF EXISTS duplicate_posts_by_title;
