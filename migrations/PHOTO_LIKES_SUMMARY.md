# Photo Likes Feature - Complete Implementation

## Overview
Users can now like individual photos in multi-image posts, not just the entire post.

## Database Changes

### New Table: `photo_likes`
```sql
- id: UUID (primary key)
- post_id: UUID (references posts)
- photo_index: INTEGER (0-based index of photo in media_urls array)
- user_id: TEXT (references users)
- created_at: TIMESTAMP
- UNIQUE constraint on (post_id, photo_index, user_id)
```

### New Function: `get_photo_likes_for_post`
Returns like counts and user's like status for each photo in a post.

## API Endpoints Added

### 1. Like a Photo
```
POST /posts/:postId/photos/:photoIndex/like
```

**Parameters:**
- `postId`: UUID of the post
- `photoIndex`: 0-based index of the photo (0 = first photo, 1 = second, etc.)

**Response:**
```json
{
  "success": true,
  "photo_index": 0,
  "likes_count": 5,
  "is_liked_by_user": true
}
```

**Errors:**
- 400: Invalid photo index or photo already liked
- 404: Post not found
- 500: Server error

### 2. Unlike a Photo
```
DELETE /posts/:postId/photos/:photoIndex/like
```

**Parameters:**
- `postId`: UUID of the post
- `photoIndex`: 0-based index of the photo

**Response:**
```json
{
  "success": true,
  "photo_index": 0,
  "likes_count": 4,
  "is_liked_by_user": false
}
```

### 3. Get Photo Likes for a Post
```
GET /posts/:postId/photos/likes
```

**Response:**
```json
[
  {
    "photo_index": 0,
    "likes_count": 5,
    "is_liked_by_user": true
  },
  {
    "photo_index": 1,
    "likes_count": 3,
    "is_liked_by_user": false
  },
  {
    "photo_index": 2,
    "likes_count": 8,
    "is_liked_by_user": true
  }
]
```

## Frontend Integration

### Example: Like a photo
```javascript
const likePhoto = async (postId, photoIndex) => {
  try {
    const response = await fetch(
      `${API_URL}/posts/${postId}/photos/${photoIndex}/like`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    const data = await response.json();
    console.log(`Photo ${photoIndex} now has ${data.likes_count} likes`);
  } catch (error) {
    console.error('Error liking photo:', error);
  }
};
```

### Example: Get all photo likes for a post
```javascript
const getPhotoLikes = async (postId) => {
  try {
    const response = await fetch(
      `${API_URL}/posts/${postId}/photos/likes`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    const likes = await response.json();
    // likes is an array with like counts for each photo
    likes.forEach(photoLike => {
      console.log(
        `Photo ${photoLike.photo_index}: ${photoLike.likes_count} likes, ` +
        `liked by user: ${photoLike.is_liked_by_user}`
      );
    });
  } catch (error) {
    console.error('Error fetching photo likes:', error);
  }
};
```

## Migration

Run `migrations/RUN_THIS_COMPLETE_MIGRATION.sql` in Supabase SQL Editor.

This includes:
1. ✅ `media_urls` column for posts
2. ✅ `photo_likes` table
3. ✅ `get_posts_with_details` function (updated)
4. ✅ `get_post_comments` function
5. ✅ `get_photo_likes_for_post` function
6. ✅ RLS policies for photo_likes

## Features

- Each photo in a multi-image post can be liked independently
- Like counts are tracked per photo
- Users can see which photos they've liked
- Prevents duplicate likes (UNIQUE constraint)
- Automatic cleanup when posts are deleted (CASCADE)
- Row Level Security enabled

## Use Cases

- Instagram-style carousel posts where users can like individual photos
- Photo galleries where each image can be appreciated separately
- Competition posts with multiple technique photos
- Training session posts with multiple action shots
