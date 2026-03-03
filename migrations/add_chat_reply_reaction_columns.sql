-- Add reply and reaction support to chat messages
-- This migration adds columns for message replies and reactions

-- Add reply_to_id column to reference another message
ALTER TABLE chat_messages 
ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES chat_messages(id);

-- Add reaction column to store emoji reactions
ALTER TABLE chat_messages 
ADD COLUMN IF NOT EXISTS reaction TEXT;

-- Create index for better query performance on replies
CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to ON chat_messages(reply_to_id);

-- Verify the changes
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'chat_messages'
AND column_name IN ('reply_to_id', 'reaction');
