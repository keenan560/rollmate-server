-- Add multiple images support to chat messages
-- This allows users to send up to 5 images per chat message

-- Add image_urls column to chat_messages table
ALTER TABLE chat_messages 
ADD COLUMN IF NOT EXISTS image_urls TEXT[];

-- Add comment to document the column
COMMENT ON COLUMN chat_messages.image_urls IS 'Array of all image URLs when message has multiple images. image_url contains the primary/first image for backward compatibility.';

-- Create index for better query performance (optional)
CREATE INDEX IF NOT EXISTS idx_chat_messages_image_urls ON chat_messages USING GIN (image_urls)
WHERE image_urls IS NOT NULL;

-- Verify the column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'chat_messages' 
AND column_name IN ('image_url', 'image_urls');
