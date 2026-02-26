# Multiple Images Backend - Implementation Summary

## What Was Added

### 1. New API Endpoint
- **Route**: `POST /posts/images`
- **Location**: `src/routes/post.routes.js`
- **Accepts**: Up to 10 images via multipart/form-data
- **Field name**: `images` (array)

### 2. Features
- Uploads all images to Supabase `post-images` storage bucket
- Generates unique filenames with timestamp and random string
- Stores first image in `media_url` (backward compatible)
- Stores all images in `media_urls` array (new field)
- Automatic cleanup on upload failure
- Returns complete post data via `get_posts_with_details`

### 3. Database Changes Required
- **Migration file**: `migrations/multiple_images_schema.sql`
- **Column added**: `media_urls TEXT[]` to `posts` table
- **Function update**: Add `media_urls` to `get_posts_with_details` SELECT

## Next Steps

1. **Run the database migration**:
   ```sql
   ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_urls TEXT[];
   ```

2. **⚠️ CRITICAL: Update Supabase function** (without this, API won't return multiple images):
   - Go to Supabase Dashboard → Database → Functions
   - Edit `get_posts_with_details` function
   - Add `media_urls TEXT[]` to the RETURNS TABLE definition
   - Add `p.media_urls` to the SELECT statement
   - See `migrations/update_get_posts_function.sql` for example

3. **Update frontend**:
   - Change endpoint from `/posts/image` to `/posts/images`
   - Send images with field name `images` (not `image`)
   - Handle `media_urls` array in post display (show carousel if length > 1)

4. **Test the endpoint**:
   ```bash
   # Test with multiple images
   curl -X POST http://localhost:3001/posts/images \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -F "content=Multiple photos!" \
     -F "images=@photo1.jpg" \
     -F "images=@photo2.jpg"
   ```

## API Usage

### Request
```javascript
const formData = new FormData();
formData.append('content', 'Check out these photos!');
formData.append('images', imageFile1);
formData.append('images', imageFile2);
formData.append('images', imageFile3);

fetch('http://localhost:3001/posts/images', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

### Response
```json
{
  "id": "post-id",
  "user_id": "user-id",
  "content": "Check out these photos!",
  "media_type": "image",
  "media_url": "https://...image1.jpg",
  "media_urls": [
    "https://...image1.jpg",
    "https://...image2.jpg",
    "https://...image3.jpg"
  ],
  "created_at": "2026-02-26T...",
  ...
}
```

## Backward Compatibility

- Old endpoint `/posts/image` still works for single images
- Existing posts without `media_urls` will have NULL/empty array
- `media_url` field is always populated (first image)
- Frontend can check if `media_urls` exists and has length > 1 to show carousel
