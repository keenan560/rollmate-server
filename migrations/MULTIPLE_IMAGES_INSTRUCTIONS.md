# Multiple Images Support - Database Migration Instructions

This guide explains how to add support for multiple images per post.

## Step 1: Run the Schema Migration

Execute the SQL migration to add the `media_urls` column:

```bash
# In your Supabase SQL Editor, run:
```

```sql
-- Add media_urls column to posts table
ALTER TABLE posts 
ADD COLUMN IF NOT EXISTS media_urls TEXT[];

-- Add comment to document the column
COMMENT ON COLUMN posts.media_urls IS 'Array of all media URLs when post has multiple images. media_url contains the primary/first image.';
```

Or simply run the migration file:
```bash
psql -h [your-supabase-host] -U postgres -d postgres -f migrations/multiple_images_schema.sql
```

## Step 2: Update the get_posts_with_details Function ⚠️ CRITICAL

**Without this step, the API will NOT return multiple images!**

You need to update your Supabase `get_posts_with_details` function to include the new `media_urls` column.

### Find the function in Supabase:
1. Go to your Supabase Dashboard
2. Navigate to **Database → Functions**
3. Find `get_posts_with_details`
4. Click to edit it

### Update TWO places in the function:

#### A. Update the RETURNS TABLE definition:
```sql
RETURNS TABLE (
    id INTEGER,
    user_id TEXT,
    content TEXT,
    media_type TEXT,
    media_url TEXT,
    media_urls TEXT[],  -- ← ADD THIS LINE
    video_thumbnail_url TEXT,
    ...
)
```

#### B. Update the SELECT statement:
```sql
SELECT 
  p.id,
  p.user_id,
  p.content,
  p.media_type,
  p.media_url,
  p.media_urls,  -- ← ADD THIS LINE
  p.video_thumbnail_url,
  p.created_at,
  ...
FROM posts p
...
```

See `migrations/update_get_posts_function.sql` for a complete example.

## Step 3: Test the Backend Endpoint

The new endpoint is already added to your backend at:
- `POST /posts/images` - Accepts up to 10 images

Test it with:
```bash
curl -X POST http://localhost:3001/posts/images \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "content=Check out these photos!" \
  -F "images=@image1.jpg" \
  -F "images=@image2.jpg" \
  -F "images=@image3.jpg"
```

## Step 4: Update Frontend (if needed)

Your frontend is already set up to send multiple images. Make sure it's calling the new endpoint:
- Change from `/posts/image` (singular) to `/posts/images` (plural)
- Send images as `FormData` with the field name `images` (not `image`)

## What This Enables

- Users can select up to 10 images when creating a post
- All images are uploaded to Supabase storage
- The first image is stored in `media_url` (backward compatible)
- All images are stored in `media_urls` array
- **The API returns all images in the `media_urls` field** (after updating the function)
- Posts with single images work the same as before
- Posts with multiple images have the full array available for carousel display

## Backward Compatibility

- Existing posts with single images will have `media_urls` as NULL or empty
- The `media_url` field is still populated for all posts
- Old clients using `/posts/image` endpoint continue to work
- New clients can use `/posts/images` for multiple image support
