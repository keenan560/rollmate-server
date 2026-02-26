# Safe Way to Update get_posts_with_details Function

The error you're getting means the column types in the function don't match your actual database. Here's how to fix it safely:

## Step 1: Get Your Current Function Definition

Run this in Supabase SQL Editor:

```sql
SELECT pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname = 'get_posts_with_details';
```

This will show you the EXACT current function with correct types.

## Step 2: Copy the Function Definition

Copy the entire function definition from the result.

## Step 3: Modify It

In the copied function:

1. Find the `RETURNS TABLE (` section
2. Add this line after `media_url TEXT,`:
   ```sql
   media_urls TEXT[],
   ```

3. Find the main `SELECT` statement (inside the function body)
4. Add this line after `p.media_url,`:
   ```sql
   p.media_urls,
   ```

## Step 4: Drop and Recreate

```sql
-- Drop the old function
DROP FUNCTION IF EXISTS get_posts_with_details(INTEGER, INTEGER, TEXT);

-- Paste your modified function here
CREATE OR REPLACE FUNCTION get_posts_with_details(
    -- ... your modified function
)
```

## Example

If your current function looks like this:

```sql
RETURNS TABLE (
    id INTEGER,
    user_id TEXT,
    content TEXT,
    media_type TEXT,
    media_url TEXT,
    -- ADD HERE: media_urls TEXT[],
    video_thumbnail_url TEXT,
    ...
)
```

And in the SELECT:

```sql
SELECT 
    p.id,
    p.user_id,
    p.content,
    p.media_type,
    p.media_url,
    -- ADD HERE: p.media_urls,
    p.video_thumbnail_url,
    ...
```

## Alternative: Quick Fix Without Function Update

If you're having trouble with the function, you can temporarily modify your backend to fetch media_urls separately:

```javascript
// In post.routes.js, after getting posts
const { data, error } = await supabase.rpc("get_posts_with_details", {
  p_limit: limit,
  p_offset: offset,
  p_current_user_id: currentUserId,
});

// Fetch media_urls for each post
if (data && data.length > 0) {
  const postIds = data.map(p => p.id);
  const { data: mediaData } = await supabase
    .from('posts')
    .select('id, media_urls')
    .in('id', postIds);
  
  // Merge media_urls into posts
  const mediaMap = new Map(mediaData.map(m => [m.id, m.media_urls]));
  data.forEach(post => {
    post.media_urls = mediaMap.get(post.id) || null;
  });
}

res.json(data);
```

This way you don't need to modify the function at all!
