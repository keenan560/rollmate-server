# Multiple Images Feature - Complete Implementation Guide

## Overview
This implementation adds support for multiple images across your entire app:
- **Posts**: Up to 10 images per post
- **Photo Likes**: Like individual photos in multi-image posts
- **Chat Messages**: Up to 5 images per message

## Quick Start

### 1. Run the Database Migration
Execute this single file in your Supabase SQL Editor:
```
migrations/COMPLETE_MULTIPLE_IMAGES_MIGRATION.sql
```

This will:
- ✅ Add `media_urls` column to posts
- ✅ Add `image_urls` column to chat_messages
- ✅ Create `photo_likes` table
- ✅ Create/update all necessary functions
- ✅ Set up RLS policies
- ✅ Create indexes for performance

### 2. Backend is Ready
All backend endpoints are already implemented:
- ✅ `GET /posts` - Get all posts (feed)
- ✅ `GET /posts/user/:userId` - Get posts by specific user
- ✅ `POST /posts/images` - Create post with multiple images
- ✅ `POST /posts/:postId/photos/:photoIndex/like` - Like specific photo
- ✅ `DELETE /posts/:postId/photos/:photoIndex/like` - Unlike photo
- ✅ `GET /posts/:postId/photos/likes` - Get photo likes
- ✅ `POST /chat-messages` - Send message with multiple images
- ✅ `GET /chat-messages/:rollRequestId` - Get chat messages with images

### 3. Update Your Frontend
See the detailed guides below for frontend integration.

## Features by Module

### Posts (Up to 10 Images)

**Get all posts (feed):**
```
GET /posts?page=1&limit=30
```

**Get posts by specific user:**
```
GET /posts/user/:userId?page=1&limit=100
```

**Create post with multiple images:**
```
POST /posts/images
Content-Type: multipart/form-data

Fields:
- content: string (post text)
- images: File[] (up to 10 images)
```

**Response includes:**
```json
{
  "media_url": "first-image.jpg",
  "media_urls": ["image1.jpg", "image2.jpg", "image3.jpg"]
}
```

**Frontend Example:**
```javascript
// Create post with multiple images
const formData = new FormData();
formData.append('content', 'Check out these photos!');
imageFiles.forEach(file => formData.append('images', file));

await fetch('/posts/images', {
  method: 'POST',
  body: formData,
  headers: { 'Authorization': `Bearer ${token}` }
});

// Get posts by user
const response = await fetch(`/posts/user/${userId}`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
const userPosts = await response.json();
```

### Photo Likes (Individual Photo Likes)

**Like a specific photo:**
```
POST /posts/:postId/photos/:photoIndex/like
```

**Unlike a photo:**
```
DELETE /posts/:postId/photos/:photoIndex/like
```

**Get all photo likes for a post:**
```
GET /posts/:postId/photos/likes

Response:
[
  { "photo_index": 0, "likes_count": 5, "is_liked_by_user": true },
  { "photo_index": 1, "likes_count": 3, "is_liked_by_user": false }
]
```

**Frontend Example:**
```javascript
// Like photo at index 2
await fetch(`/posts/${postId}/photos/2/like`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});

// Get all photo likes
const response = await fetch(`/posts/${postId}/photos/likes`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
const photoLikes = await response.json();
```

### Chat Messages (Up to 5 Images)

**API Endpoint:**
```
POST /chat-messages
Content-Type: multipart/form-data

Fields:
- chatId: string (roll request ID)
- message: string (optional text)
- images: File[] (up to 5 images)
```

**Response includes:**
```json
{
  "image_url": "first-image.jpg",
  "image_urls": ["image1.jpg", "image2.jpg"]
}
```

**Frontend Example:**
```javascript
const formData = new FormData();
formData.append('chatId', rollRequestId);
formData.append('message', 'Check these out!');
imageFiles.forEach(file => formData.append('images', file));

await fetch('/chat-messages', {
  method: 'POST',
  body: formData,
  headers: { 'Authorization': `Bearer ${token}` }
});
```

## Database Schema Changes

### posts table
```sql
media_urls TEXT[]  -- Array of all image URLs
```

### chat_messages table
```sql
image_urls TEXT[]  -- Array of all image URLs
```

### photo_likes table (NEW)
```sql
id UUID PRIMARY KEY
post_id UUID REFERENCES posts(id)
photo_index INTEGER  -- 0-based index
user_id TEXT REFERENCES users(id)
created_at TIMESTAMP
UNIQUE(post_id, photo_index, user_id)
```

## Backward Compatibility

All changes are backward compatible:
- Old posts with single `media_url` still work
- Old chat messages with single `image_url` still work
- Frontend should check for arrays first, fall back to single URL
- Existing endpoints continue to function

## Frontend Display Logic

### Posts with Multiple Images
```javascript
const PostImages = ({ post }) => {
  // Handle both old and new format
  const images = post.media_urls || (post.media_url ? [post.media_url] : []);
  
  if (images.length === 0) return null;
  
  return (
    <Carousel>
      {images.map((url, index) => (
        <Image key={index} source={{ uri: url }} />
      ))}
    </Carousel>
  );
};
```

### Chat Messages with Multiple Images
```javascript
const ChatMessage = ({ message }) => {
  const images = message.image_urls || (message.image_url ? [message.image_url] : []);
  
  return (
    <View>
      <Text>{message.message}</Text>
      {images.length > 0 && (
        <ImageGallery images={images} />
      )}
    </View>
  );
};
```

## File Structure

```
migrations/
├── COMPLETE_MULTIPLE_IMAGES_MIGRATION.sql  ← RUN THIS FIRST
├── README_MULTIPLE_IMAGES.md               ← You are here
├── MULTIPLE_IMAGES_SUMMARY.md              ← Posts feature details
├── PHOTO_LIKES_SUMMARY.md                  ← Photo likes details
├── CHAT_MULTIPLE_IMAGES_SUMMARY.md         ← Chat feature details
├── multiple_images_schema.sql              ← Posts schema only
├── photo_likes_schema.sql                  ← Photo likes schema only
└── chat_multiple_images_schema.sql         ← Chat schema only

src/routes/
├── post.routes.js                          ← Updated with all endpoints
└── chat.routes.js                          ← Updated for multiple images
```

## Testing Checklist

### Posts
- [ ] Create post with 1 image
- [ ] Create post with 10 images
- [ ] View post with multiple images in feed
- [ ] Verify `media_urls` array is returned

### Photo Likes
- [ ] Like individual photo in multi-image post
- [ ] Unlike individual photo
- [ ] Get photo likes for a post
- [ ] Verify like counts per photo

### Chat
- [ ] Send message with 1 image
- [ ] Send message with 5 images
- [ ] View message with multiple images
- [ ] Verify `image_urls` array is returned

## Troubleshooting

### Function not found error
- Make sure you ran the complete migration SQL
- Check function exists: `SELECT * FROM information_schema.routines WHERE routine_name = 'get_posts_with_details'`

### Type mismatch error
- The migration drops and recreates functions with correct types
- If error persists, manually drop function: `DROP FUNCTION IF EXISTS get_posts_with_details(INTEGER, INTEGER, TEXT);`

### Images not uploading
- Check Supabase storage buckets exist: `post-images`, `chat-attachments`
- Verify bucket permissions allow authenticated uploads
- Check file size limits in middleware

### Arrays not returned
- Verify columns exist: `SELECT column_name FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'media_urls'`
- Check function returns array type: `media_urls TEXT[]`

## Support

For detailed information on each feature:
- Posts: See `MULTIPLE_IMAGES_SUMMARY.md`
- Photo Likes: See `PHOTO_LIKES_SUMMARY.md`
- Chat: See `CHAT_MULTIPLE_IMAGES_SUMMARY.md`
