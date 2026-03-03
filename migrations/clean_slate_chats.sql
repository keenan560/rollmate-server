-- Clean Slate: Delete All Chat and Roll Request Data
-- This will remove all chats, messages, and roll requests to start fresh
-- WARNING: This is irreversible! Make sure you want to do this.

-- Step 1: Delete all chat messages first (due to foreign key constraints)
-- Note: chat_messages has a self-referencing foreign key (reply_to_id)
UPDATE chat_messages SET reply_to_id = NULL WHERE reply_to_id IS NOT NULL;
DELETE FROM chat_messages;

-- Step 2: Delete all chats (must be before roll_requests due to foreign key)
DELETE FROM chats;

-- Step 3: Delete all roll requests (friend requests, training partner requests, etc.)
DELETE FROM roll_requests;

-- Step 4: Verify everything is deleted
SELECT 'chat_messages' as table_name, COUNT(*) as remaining_rows FROM chat_messages
UNION ALL
SELECT 'chats' as table_name, COUNT(*) as remaining_rows FROM chats
UNION ALL
SELECT 'roll_requests' as table_name, COUNT(*) as remaining_rows FROM roll_requests;

-- All should show 0 rows

-- Step 5: Reset sequences (optional - keeps IDs starting from 1)
ALTER SEQUENCE IF EXISTS chat_messages_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS chats_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS roll_requests_id_seq RESTART WITH 1;

-- Done! You now have a clean slate for testing.
-- The backend duplicate prevention logic will ensure no duplicates are created going forward.
-- 
-- What was deleted:
-- - All chat messages (including replies and reactions)
-- - All chats
-- - All roll requests (friend requests, training partner requests, etc.)
--
-- What was NOT deleted:
-- - Users
-- - Posts
-- - Achievements
-- - All other data
