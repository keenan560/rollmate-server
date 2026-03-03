-- Execute Merge Duplicate Chats
-- Based on the analysis, we have 2 sets of duplicates to merge

-- BACKUP FIRST! (Optional but recommended)
-- You can export your chat_messages and chats tables before running this

-- ============================================
-- Merge Set 1: Chat IDs [8, 9]
-- Keep: 8 (oldest)
-- Merge from: 9
-- ============================================

-- Move all messages from chat 9 to chat 8
UPDATE chat_messages 
SET chat_id = 8 
WHERE chat_id = 9;

-- Delete the duplicate chat 9
DELETE FROM chats WHERE id = 9;

-- ============================================
-- Merge Set 2: Chat IDs [7, 10]
-- Keep: 7 (oldest)
-- Merge from: 10
-- ============================================

-- Move all messages from chat 10 to chat 7
UPDATE chat_messages 
SET chat_id = 7 
WHERE chat_id = 10;

-- Delete the duplicate chat 10
DELETE FROM chats WHERE id = 10;

-- ============================================
-- Verification: Check that no duplicates remain
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
-- Optional: View merged chats
-- ============================================
SELECT 
  c.id as chat_id,
  c.roll_request_id,
  COUNT(cm.id) as message_count,
  MIN(cm.created_at) as first_message,
  MAX(cm.created_at) as last_message
FROM chats c
LEFT JOIN chat_messages cm ON cm.chat_id = c.id
WHERE c.id IN (7, 8)
GROUP BY c.id, c.roll_request_id
ORDER BY c.id;
