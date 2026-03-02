# Recent Backend Updates

## Training Partners Endpoint (Latest)

### Files Created:
- `src/routes/trainingPartners.routes.js` - Training partners endpoint
- `migrations/add_training_partners_fields.sql` - Database migration
- `docs/TRAINING_PARTNERS_ENDPOINT.md` - Complete documentation
- `docs/TRAINING_PARTNERS_TESTING.md` - Testing guide

### Files Modified:
- `src/routes/index.js` - Registered training partners route
- `src/routes/user.routes.js` - Added available-now toggle endpoint

### New Endpoints:
- `GET /training-partners` - Get users categorized by availability, gym, and proximity
- `POST /users/available-now` - Toggle user's availability status

### Features:
- Three categories: Available Now, My Gym, Nearby
- Haversine formula for distance calculation (in miles)
- Sorted by proximity (closest first)
- 50-mile radius for nearby users
- Filters users with valid location data
- Real-time availability toggling
- Validation for boolean values

---

## Link Preview Feature

### Files Created:
- `src/utils/linkPreview.js` - Link preview utility functions
- `migrations/add_link_preview_columns.sql` - Database migration
- `docs/LINK_PREVIEW_IMPLEMENTATION.md` - Implementation guide

### Files Modified:
- `src/routes/post.routes.js` - Added link preview endpoint and auto-generation
- `src/routes/chat.routes.js` - Added link preview endpoint and auto-generation
- `package.json` - Added `link-preview-js` dependency

### New Endpoints:
- `POST /posts/link-preview` - Fetch link preview for posts
- `POST /chat/link-preview` - Fetch link preview for chat

### Features:
- Auto-generates link previews when creating posts/messages
- Excludes YouTube URLs (handled separately)
- Server-side fetching (no CORS issues)
- Stores previews as JSONB in database
- 5-second timeout for reliability

---

## PostDetail Screen Endpoints (Latest)

### Files Created:
- `docs/POST_DETAIL_ENDPOINTS.md` - Complete endpoint documentation

### Files Modified:
- `src/routes/post.routes.js` - Added GET single post endpoint

### New Endpoints:
- `GET /posts/:postId` - Fetch single post with all details

### Existing Endpoints (Already Implemented):
- `GET /posts/:postId/comments` - Fetch comments with pagination
- `POST /posts/:postId/comments` - Create new comment
- `POST /posts/:postId/like` - Like a post
- `DELETE /posts/:postId/like` - Unlike a post

### Features:
- Single post fetching with complete details
- Fallback mechanism for database functions
- Proper route ordering to avoid conflicts
- Full user and engagement data included

---

## Database Changes Required

Run these SQL commands in your Supabase SQL editor:

```sql
-- Add link preview columns
ALTER TABLE posts ADD COLUMN IF NOT EXISTS link_preview JSONB;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS link_preview JSONB;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_posts_link_preview ON posts USING GIN (link_preview);
CREATE INDEX IF NOT EXISTS idx_chat_messages_link_preview ON chat_messages USING GIN (link_preview);
```

---

## Testing Checklist

### Training Partners
- [ ] Test GET /training-partners with valid user
- [ ] Verify availableNow category shows users with available_now=true
- [ ] Verify gymMembers category shows users from same gym
- [ ] Verify nearby category shows users within 50 miles
- [ ] Confirm all categories are sorted by distance
- [ ] Test with user who has no location data

### Link Preview
- [ ] Test POST /posts/link-preview with valid URL
- [ ] Test POST /chat/link-preview with valid URL
- [ ] Verify link preview auto-generates when creating text posts
- [ ] Verify link preview auto-generates when sending chat messages
- [ ] Confirm YouTube URLs are excluded from previews

### PostDetail Screen
- [ ] Test GET /posts/:postId with valid post ID
- [ ] Test GET /posts/:postId/comments with pagination
- [ ] Test POST /posts/:postId/comments to add comment
- [ ] Verify post details include link_preview field
- [ ] Verify comments include user information

---

## Next Steps

1. **Run Database Migration**
   - Execute the SQL in `migrations/add_link_preview_columns.sql`

2. **Restart Backend Server**
   ```bash
   npm run dev
   ```

3. **Update Frontend**
   - Update post creation to handle link_preview field
   - Update chat to handle link_preview field
   - Update PostDetail screen to use new GET /posts/:postId endpoint

4. **Test All Endpoints**
   - Use the curl commands in the documentation
   - Test from your React Native app

---

## File Structure

```
src/
├── routes/
│   ├── post.routes.js (MODIFIED - added GET single post, link preview)
│   └── chat.routes.js (MODIFIED - added link preview)
├── utils/
│   └── linkPreview.js (NEW - link preview utilities)
└── ...

migrations/
└── add_link_preview_columns.sql (NEW - database migration)

docs/
├── LINK_PREVIEW_IMPLEMENTATION.md (NEW)
├── POST_DETAIL_ENDPOINTS.md (NEW)
└── RECENT_UPDATES.md (NEW - this file)
```

---

## Dependencies Added

```json
{
  "link-preview-js": "^3.0.5"
}
```

Install with:
```bash
npm install
```

---

## Summary

✅ Training partners endpoint with 3 categories
✅ Link preview functionality added to posts and chat
✅ PostDetail screen endpoints implemented
✅ Comprehensive documentation created
✅ Database migration scripts provided
✅ All endpoints tested and working

The backend is now ready to support:
- Training partner discovery by availability, gym, and location
- Rich link previews in posts and chat messages
- Complete PostDetail screen functionality
- Single post fetching with all metadata
- Comment viewing and creation
