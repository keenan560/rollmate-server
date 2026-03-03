-- Merge Duplicate Chats Migration
-- This script identifies and merges duplicate chat instances between the same users

-- Step 1: Find duplicate chats (chats between the same two users)
-- This query shows which users have multiple chats
WITH user_pairs AS (
  SELECT 
    LEAST(rr1.sender_id, rr1.receiver_id) as user1,
    GREATEST(rr1.sender_id, rr1.receiver_id) as user2,
    array_agg(c.id ORDER BY c.created_at) as chat_ids,
    array_agg(rr1.id) as roll_request_ids,
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

-- Step 2: For each duplicate, keep the oldest chat and move messages to it
-- WARNING: Review the results from Step 1 before running this!

-- Example: If you have duplicate chats with IDs [123, 456]
-- Keep chat 123 (oldest) and move all messages from 456 to 123

-- DO NOT RUN THIS AUTOMATICALLY - Customize for your specific chat IDs
-- UPDATE chat_messages SET chat_id = 123 WHERE chat_id = 456;
-- DELETE FROM chats WHERE id = 456;

-- Step 3: After merging, verify no duplicates remain
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

-- If this returns no rows, all duplicates are merged!
