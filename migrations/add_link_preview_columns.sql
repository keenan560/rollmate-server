-- Add link_preview column to posts table
ALTER TABLE posts 
ADD COLUMN IF NOT EXISTS link_preview JSONB;

-- Add link_preview column to chat_messages table
ALTER TABLE chat_messages 
ADD COLUMN IF NOT EXISTS link_preview JSONB;

-- Add index for better query performance on posts
CREATE INDEX IF NOT EXISTS idx_posts_link_preview 
ON posts USING GIN (link_preview);

-- Add index for better query performance on chaxt_messages
CREATE INDEX IF NOT EXISTS idx_chat_messages_link_preview 
ON chat_messages USING GIN (link_preview);

-- Add comment to document the column structure
COMMENT ON COLUMN posts.link_preview IS 'JSONB object containing: url, title, description, image, siteName';
COMMENT ON COLUMN chat_messages.link_preview IS 'JSONB object containing: url, title, description, image, siteName';
