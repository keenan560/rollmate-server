# Quick Reference - New Endpoints

## Link Preview

```bash
# Get link preview for posts
POST /posts/link-preview
Body: { "url": "https://example.com" }

# Get link preview for chat
POST /chat/link-preview
Body: { "url": "https://example.com" }
```

## PostDetail Screen

```bash
# Get single post
GET /posts/:postId

# Get comments
GET /posts/:postId/comments?page=1&limit=50

# Add comment
POST /posts/:postId/comments
Body: { "content": "Great post!" }
```

## Training Partners

```bash
# Get training partners
GET /training-partners

# Toggle availability
POST /users/available-now
Body: { "available_now": true }
```

## Database Migrations

```sql
-- Link preview
ALTER TABLE posts ADD COLUMN link_preview JSONB;
ALTER TABLE chat_messages ADD COLUMN link_preview JSONB;

-- Training partners
ALTER TABLE users ADD COLUMN latitude NUMERIC;
ALTER TABLE users ADD COLUMN longitude NUMERIC;
ALTER TABLE users ADD COLUMN primary_gym TEXT;
ALTER TABLE users ADD COLUMN available_now BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN is_online BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN weight NUMERIC;
```

## Install Dependencies

```bash
npm install
```

## Restart Server

```bash
npm run dev
```

## Test Endpoints

```bash
# Replace YOUR_TOKEN with actual Firebase token

# Link preview
curl -X POST http://localhost:3000/posts/link-preview \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com"}'

# Single post
curl -X GET http://localhost:3000/posts/POST_ID \
  -H "Authorization: Bearer YOUR_TOKEN"

# Training partners
curl -X GET http://localhost:3000/training-partners \
  -H "Authorization: Bearer YOUR_TOKEN"

# Toggle availability
curl -X POST http://localhost:3000/users/available-now \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"available_now": true}'
```

## Files Modified

- `src/routes/post.routes.js` - Added single post & link preview
- `src/routes/chat.routes.js` - Added link preview
- `src/routes/user.routes.js` - Added availability toggle
- `src/routes/index.js` - Registered training partners
- `package.json` - Added link-preview-js

## Files Created

- `src/routes/trainingPartners.routes.js`
- `src/utils/linkPreview.js`
- `migrations/add_link_preview_columns.sql`
- `migrations/add_training_partners_fields.sql`

## Documentation

- `IMPLEMENTATION_SUMMARY.md` - Complete overview
- `LINK_PREVIEW_IMPLEMENTATION.md` - Link preview guide
- `POST_DETAIL_ENDPOINTS.md` - PostDetail endpoints
- `TRAINING_PARTNERS_ENDPOINT.md` - Training partners guide
- `TRAINING_PARTNERS_TESTING.md` - Testing guide
- `RECENT_UPDATES.md` - Recent changes
- `QUICK_REFERENCE.md` - This file

## Status

✅ All features implemented and tested
✅ Documentation complete
✅ Ready for deployment
