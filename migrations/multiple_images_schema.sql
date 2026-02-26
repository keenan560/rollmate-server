-- Add media_urls column to posts table for multiple image support
-- This allows storing an array of image URLs when a post has multiple images

ALTER TABLE posts 
ADD COLUMN IF NOT EXISTS media_urls TEXT[];

-- Add comment to document the column
COMMENT ON COLUMN posts.media_urls IS 'Array of all media URLs when post has multiple images. media_url contains the primary/first image.';
