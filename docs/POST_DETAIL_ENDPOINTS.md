# PostDetail Screen Backend Integration

## Overview
The PostDetail screen requires three endpoints to function properly. All endpoints have been implemented in `src/routes/post.routes.js`.

## Implemented Endpoints

### 1. GET /posts/:postId
Fetches a single post with all details (user info, likes, comments count, etc.)

**Endpoint:** `GET /posts/:postId`

**Headers:**
```
Authorization: Bearer <firebase-token>
```

**Response:**
```json
{
  "id": "post-uuid",
  "user_id": "user-id",
  "content": "Post content text",
  "media_type": "none|image|video",
  "media_url": "https://...",
  "media_urls": ["https://...", "https://..."],
  "link_preview": {
    "url": "https://example.com",
    "title": "Page Title",
    "description": "Description",
    "image": "https://...",
    "siteName": "Site Name"
  },
  "created_at": "2024-01-01T00:00:00Z",
  "user": {
    "id": "user-id",
    "first_name": "John",
    "last_name": "Doe",
    "avatar_url": "https://..."
  },
  "likes_count": 10,
  "comments_count": 5,
  "is_liked_by_user": true
}
```

**Implementation Details:**
- First tries to use `get_single_post_with_details` RPC function (if available)
- Falls back to `get_posts_with_details` and filters by post ID
- Returns 404 if post not found
- Includes all post metadata, user info, and engagement stats

---

### 2. GET /posts/:postId/comments
Fetches all comments for a specific post with pagination support

**Endpoint:** `GET /posts/:postId/comments`

**Headers:**
```
Authorization: Bearer <firebase-token>
```

**Query Parameters:**
- `page` (optional): Page number, default 1
- `limit` (optional): Items per page, default 50

**Response:**
```json
[
  {
    "id": "comment-uuid",
    "post_id": "post-uuid",
    "user_id": "user-id",
    "content": "Comment text",
    "created_at": "2024-01-01T00:00:00Z",
    "user": {
      "id": "user-id",
      "first_name": "Jane",
      "last_name": "Smith",
      "avatar_url": "https://..."
    }
  }
]
```

**Implementation Details:**
- Uses `get_post_comments` RPC function for optimized queries
- Returns comments in chronological order (oldest first)
- Supports pagination for large comment threads
- Includes user information for each comment

---

### 3. POST /posts/:postId/comments
Creates a new comment on a post

**Endpoint:** `POST /posts/:postId/comments`

**Headers:**
```
Authorization: Bearer <firebase-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "content": "This is my comment"
}
```

**Response:**
```json
{
  "id": "comment-uuid",
  "post_id": "post-uuid",
  "user_id": "user-id",
  "content": "This is my comment",
  "created_at": "2024-01-01T00:00:00Z",
  "user": {
    "id": "user-id",
    "first_name": "John",
    "last_name": "Doe",
    "avatar_url": "https://..."
  }
}
```

**Validation:**
- Content is required and cannot be empty
- Content is trimmed of whitespace
- Returns 400 if validation fails

**Implementation Details:**
- Inserts comment into `post_comments` table
- Fetches complete comment with user info using `get_post_comments` RPC
- Returns newly created comment with all details

---

## Additional Related Endpoints

### Like/Unlike Post
Already implemented:
- `POST /posts/:postId/like` - Like a post
- `DELETE /posts/:postId/like` - Unlike a post

### Photo Likes (Multi-image posts)
Already implemented:
- `POST /posts/:postId/photos/:photoIndex/like` - Like specific photo
- `DELETE /posts/:postId/photos/:photoIndex/like` - Unlike specific photo
- `GET /posts/:postId/photos/likes` - Get all photo likes for a post

### Post Management
Already implemented:
- `PUT /posts/:postId` - Edit post content
- `DELETE /posts/:postId` - Soft delete post
- `POST /posts/report` - Report a post
- `POST /posts/hide` - Hide a post from feed
- `POST /posts/unhide` - Unhide a post

---

## Testing the Endpoints

### Test GET Single Post
```bash
curl -X GET http://localhost:3000/posts/YOUR_POST_ID \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"
```

### Test GET Comments
```bash
curl -X GET "http://localhost:3000/posts/YOUR_POST_ID/comments?page=1&limit=20" \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"
```

### Test POST Comment
```bash
curl -X POST http://localhost:3000/posts/YOUR_POST_ID/comments \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Great post!"}'
```

---

## Database Requirements

### Required Tables

#### posts
```sql
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  content TEXT,
  media_url TEXT,
  media_urls TEXT[],
  media_type TEXT,
  link_preview JSONB,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### post_comments
```sql
CREATE TABLE post_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### post_likes
```sql
CREATE TABLE post_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);
```

#### users
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  -- other user fields...
);
```

### Required RPC Functions

#### get_posts_with_details
Returns posts with user info, likes count, comments count, and user engagement status.

#### get_single_post_with_details (optional but recommended)
Optimized function to fetch a single post by ID with all details.

#### get_post_comments
Returns comments for a post with user information, ordered chronologically.

---

## Frontend Integration Example

### Fetch Single Post
```javascript
const fetchPost = async (postId) => {
  try {
    const idToken = await auth().currentUser?.getIdToken();
    const response = await fetch(`${getBaseUrl()}/posts/${postId}`, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch post');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching post:', error);
    throw error;
  }
};
```

### Fetch Comments
```javascript
const fetchComments = async (postId, page = 1) => {
  try {
    const idToken = await auth().currentUser?.getIdToken();
    const response = await fetch(
      `${getBaseUrl()}/posts/${postId}/comments?page=${page}&limit=50`,
      {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch comments');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching comments:', error);
    throw error;
  }
};
```

### Add Comment
```javascript
const addComment = async (postId, content) => {
  try {
    const idToken = await auth().currentUser?.getIdToken();
    const response = await fetch(`${getBaseUrl()}/posts/${postId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      throw new Error('Failed to add comment');
    }

    return await response.json();
  } catch (error) {
    console.error('Error adding comment:', error);
    throw error;
  }
};
```

---

## Troubleshooting

### "Post not found" error
1. Verify the post ID is correct and exists in the database
2. Check that `get_posts_with_details` RPC function exists in Supabase
3. Ensure the post is not soft-deleted (`is_deleted = false`)
4. Check server logs for detailed error messages

### Comments not loading
1. Verify `get_post_comments` RPC function exists in Supabase
2. Check that the `post_comments` table exists with correct schema
3. Ensure foreign key relationships are set up correctly
4. Check that comments exist for the post

### Authentication errors
1. Verify `verifyToken` middleware is working correctly
2. Check that Firebase token is being sent in Authorization header
3. Ensure the user is logged in and token is not expired
4. Check Firebase Admin SDK configuration

### Performance issues
1. Add indexes on frequently queried columns:
   ```sql
   CREATE INDEX idx_post_comments_post_id ON post_comments(post_id);
   CREATE INDEX idx_post_likes_post_id ON post_likes(post_id);
   CREATE INDEX idx_posts_user_id ON posts(user_id);
   ```
2. Consider implementing caching for frequently accessed posts
3. Use pagination for comments on posts with many comments

---

## Route Order Important Note

The `GET /posts/:postId` endpoint MUST be defined BEFORE more specific routes like:
- `/posts/:postId/like`
- `/posts/:postId/comments`
- `/posts/:postId/photos/:photoIndex/like`

This is because Express matches routes in order, and more specific routes should come after general ones to avoid conflicts.

Current order in the file (correct):
1. `GET /posts/:postId` - Get single post
2. `POST /posts/:postId/like` - Like post
3. `DELETE /posts/:postId/like` - Unlike post
4. `GET /posts/:postId/comments` - Get comments
5. `POST /posts/:postId/comments` - Add comment
6. Other specific routes...

---

## Summary

All three required endpoints for the PostDetail screen are now implemented:

✅ `GET /posts/:postId` - Fetch single post with all details
✅ `GET /posts/:postId/comments` - Fetch comments with pagination
✅ `POST /posts/:postId/comments` - Create new comment

The implementation includes:
- Proper error handling
- Authentication via Firebase tokens
- Pagination support for comments
- Complete user information in responses
- Link preview support
- Multi-image post support
- Fallback mechanisms for database functions
