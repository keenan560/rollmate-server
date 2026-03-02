# Link Preview Implementation Guide

## Overview
Link preview functionality has been added to both posts and chat messages. The system automatically detects URLs in text content and generates rich previews (excluding YouTube URLs, which are handled separately).

## Backend Implementation

### 1. Package Installed
- `link-preview-js` - Handles fetching metadata from URLs

### 2. Files Created/Modified

#### New Files:
- `src/utils/linkPreview.js` - Core link preview utility functions
- `migrations/add_link_preview_columns.sql` - Database schema updates

#### Modified Files:
- `src/routes/post.routes.js` - Added link preview endpoints and auto-generation
- `src/routes/chat.routes.js` - Added link preview endpoints and auto-generation

### 3. API Endpoints

#### Posts Link Preview
```
POST /posts/link-preview
Authorization: Bearer <token>
Body: { "url": "https://example.com" }
Response: {
  "url": "https://example.com",
  "title": "Page Title",
  "description": "Page description",
  "image": "https://example.com/image.jpg",
  "siteName": "Example Site"
}
```

#### Chat Link Preview
```
POST /chat/link-preview
Authorization: Bearer <token>
Body: { "url": "https://example.com" }
Response: {
  "url": "https://example.com",
  "title": "Page Title",
  "description": "Page description",
  "image": "https://example.com/image.jpg",
  "siteName": "Example Site"
}
```

### 4. Database Schema

Run the migration file to add the `link_preview` JSONB column:

```sql
-- Run this in your Supabase SQL editor
\i migrations/add_link_preview_columns.sql
```

Or manually execute:
```sql
ALTER TABLE posts ADD COLUMN link_preview JSONB;
ALTER TABLE chat_messages ADD COLUMN link_preview JSONB;
```

### 5. Features

- **Auto-generation**: Link previews are automatically generated when creating posts or chat messages
- **YouTube exclusion**: YouTube URLs are excluded from link previews (handled separately by your app)
- **First URL only**: Only the first non-YouTube URL in the text gets a preview
- **Error handling**: Gracefully handles failed preview fetches
- **Timeout**: 5-second timeout to prevent hanging requests
- **JSONB storage**: Previews stored as JSONB for flexible querying

### 6. Link Preview Data Structure

```javascript
{
  url: "https://example.com",
  title: "Page Title",
  description: "Page description",
  image: "https://example.com/image.jpg",
  siteName: "Example Site"
}
```

## Frontend Integration

### React Native Example

```javascript
import { getBaseUrl } from './config';
import auth from '@react-native-firebase/auth';

const fetchPreview = async (url) => {
  try {
    const idToken = await auth().currentUser?.getIdToken();
    const response = await fetch(`${getBaseUrl()}/posts/link-preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch preview');
    }

    return await response.json();
  } catch (err) {
    console.error('Error fetching link preview:', err);
    return null;
  }
};
```

### Display Link Preview Component

```javascript
const LinkPreview = ({ previewData }) => {
  if (!previewData) return null;

  return (
    <View style={styles.previewContainer}>
      {previewData.image && (
        <Image 
          source={{ uri: previewData.image }} 
          style={styles.previewImage}
        />
      )}
      <View style={styles.previewContent}>
        <Text style={styles.previewTitle}>{previewData.title}</Text>
        {previewData.description && (
          <Text style={styles.previewDescription} numberOfLines={2}>
            {previewData.description}
          </Text>
        )}
        {previewData.siteName && (
          <Text style={styles.previewSite}>{previewData.siteName}</Text>
        )}
      </View>
    </View>
  );
};
```

## Benefits

1. **No CORS issues** - Server-side fetching avoids browser CORS restrictions
2. **Better security** - Server validates URLs before fetching
3. **Caching potential** - Previews stored in database, no need to re-fetch
4. **More reliable** - Server-side is more stable than client-side proxies
5. **Consistent UX** - Same preview data across all clients

## Testing

Test the endpoints:

```bash
# Get link preview for posts
curl -X POST http://localhost:3000/posts/link-preview \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com"}'

# Get link preview for chat
curl -X POST http://localhost:3000/chat/link-preview \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com"}'
```

## Notes

- Link previews are generated asynchronously when creating posts/messages
- If preview generation fails, the post/message is still created without a preview
- YouTube URLs are intentionally excluded from link previews
- The system uses a 5-second timeout to prevent slow responses
