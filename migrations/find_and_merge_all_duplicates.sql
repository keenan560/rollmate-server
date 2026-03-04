-- Find and Merge All Duplicate Chats
-- This script will identify ALL duplicate chats and provide merge commands

-- ============================================
-- STEP 1: Find all duplicate chats
-- ============================================
-- Run this first to see which chats need to be merged
WITH user_pairs AS (
  SELECT 
    LEAST(rr1.sender_id, rr1.receiver_id) as user1,
    GREATEST(rr1.sender_id, rr1.receiver_id) as user2,
    array_agg(c.id ORDER BY c.created_at) as chat_ids,
    COUNT(c.id) as chat_count,
    MIN(c.created_at) as oldest_chat_date
  FROM roll_requests rr1
  JOIN chats c ON c.roll_request_id = rr1.id
  WHERE rr1.status = 'accepted'
  GROUP BY 
    LEAST(rr1.sender_id, rr1.receiver_id),
    GREATEST(rr1.sender_id, rr1.receiver_id)
  HAVING COUNT(c.id) > 1
)
SELECT 
  user1,
  user2,
  chat_ids,
  chat_ids[1] as keep_this_chat_id,
  chat_count,
  oldest_chat_date
FROM user_pairs;

-- ============================================
-- STEP 2: Merge duplicates automatically
-- ============================================
-- This will merge ALL duplicate chats automatically
-- WARNING: This is a destructive operation!

-- First, let's create a temporary table with the merge plan
CREATE TEMP TABLE IF NOT EXISTS merge_plan AS
WITH user_pairs AS (
  SELECT 
    LEAST(rr1.sender_id, rr1.receiver_id) as user1,
    GREATEST(rr1.sender_id, rr1.receiver_id) as user2,
    array_agg(c.id ORDER BY c.created_at) as chat_ids,
    COUNT(c.id) as chat_count
  FROM roll_requests rr1
  JOIN chats c ON c.roll_request_id = rr1.id
  WHERE rr1.status = 'accepted'
  GROUP BY 
    LEAST(rr1.sender_id, rr1.receiver_id),
    GREATEST(rr1.sender_id, rr1.receiver_id)
  HAVING COUNT(c.id) > 1
)
SELECT 
  chat_ids[1] as keep_chat_id,
  unnest(chat_ids[2:array_length(chat_ids, 1)]) as delete_chat_id
FROM user_pairs;

-- Show the merge plan
SELECT * FROM merge_plan;

-- Execute the merge: Move all messages from duplicate chats to the main chat
UPDATE chat_messages cm
SET chat_id = mp.keep_chat_id
FROM merge_plan mp
WHERE cm.chat_id = mp.delete_chat_id;

-- Delete the duplicate chats
DELETE FROM chats c
USING merge_plan mp
WHERE c.id = mp.delete_chat_id;

-- Clean up temp table
DROP TABLE IF EXISTS merge_plan;

-- ============================================
-- STEP 3: Verify no duplicates remain
-- ============================================
SELECT 
  LEAST(rr.sender_id, rr.receiver_id) as user1,
  GREATEST(rr.sender_id, rr.receiver_id) as user2,
  COUNT(c.id) as chat_count,
  array_agg(c.id ORDER BY c.created_at) as chat_ids
FROM roll_requests rr
JOIN chats c ON c.roll_request_id = rr.id
WHERE rr.status = 'accepted'
GROUP BY 
  LEAST(rr.sender_id, rr.receiver_id),
  GREATEST(rr.sender_id, rr.receiver_id)
HAVING COUNT(c.id) > 1;

-- If this returns no rows, success! All duplicates are merged.

-- ============================================
-- STEP 4: Summary of remaining chats
-- ============================================
SELECT 
  c.id as chat_id,
  c.roll_request_id,
  rr.sender_id,
  rr.receiver_id,
  COUNT(cm.id) as message_count,
  c.created_at as chat_created,
  MAX(cm.created_at) as last_message
FROM chats c
JOIN roll_requests rr ON c.roll_request_id = rr.id
LEFT JOIN chat_messages cm ON cm.chat_id = c.id
WHERE rr.status = 'accepted'
GROUP BY c.id, c.roll_request_id, rr.sender_id, rr.receiver_id, c.created_at
ORDER BY c.created_at DESC;
