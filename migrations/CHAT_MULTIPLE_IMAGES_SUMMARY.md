# Chat Multiple Images Feature

## Overview
Users can now send up to 5 images in a single chat message, similar to WhatsApp or Telegram.

## Database Changes

### Updated Table: `chat_messages`
Added new column:
- `image_urls`: TEXT[] - Array of all image URLs when message has multiple images
- `image_url`: TEXT - Still exists for backward compatibility (contains first image)

## Backend Changes

### Updated Endpoint: POST /chat-messages

**Changes:**
- Now accepts `images` (array) instead of `image` (single file)
- Supports up to 5 images per message
- Uses `chatImageUpload.array('images', 5)` middleware

**Request (multipart/form-data):**
```javascript
FormData:
- chatId: string (roll request ID)
- message: string (optional text message)
- images: File[] (up to 5 image files)
```

**Response:**
```json
{
  "id": "uuid",
  "chat_id": 123,
  "sender_id": "user-id",
  "message": "Check out these photos!",
  "image_url": "https://...first-image.jpg",
  "image_urls": [
    "https://...first-image.jpg",
    "https://...second-image.jpg",
    "https://...third-image.jpg"
  ],
  "created_at": "2026-02-26T...",
  "sender": {
    "id": "user-id",
    "first_name": "John",
    "last_name": "Doe",
    "avatar_url": "https://..."
  }
}
```

### Endpoint: GET /chat-messages/:rollRequestId
No changes needed - automatically returns `image_urls` field.

## Migration Steps

1. **Run the database migration:**
   ```sql
   -- In Supabase SQL Editor
   ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image_urls TEXT[];
   ```
   Or run: `migrations/chat_multiple_images_schema.sql`

2. **Backend is already updated** in `src/routes/chat.routes.js`

3. **Update your frontend** to:
   - Send multiple images with field name `images` (not `image`)
   - Display `image_urls` array in chat bubbles
   - Show image carousel/gallery for messages with multiple images

## Frontend Integration Example

### Sending Multiple Images
```javascript
const sendChatMessage = async (chatId, message, imageFiles) => {
  const formData = new FormData();
  formData.append('chatId', chatId);
  formData.append('message', message);
  
  // Add multiple images
  imageFiles.forEach(file => {
    formData.append('images', file);
  });

  const response = await fetch(`${API_URL}/chat-messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  return response.json();
};
```

### Displaying Multiple Images
```javascript
const ChatMessage = ({ message }) => {
  const images = message.image_urls || (message.image_url ? [message.image_url] : []);
  
  return (
    <View>
      <Text>{message.message}</Text>
      {images.length > 0 && (
        <ScrollView horizontal>
          {images.map((imageUrl, index) => (
            <Image 
              key={index}
              source={{ uri: imageUrl }}
              style={{ width: 200, height: 200, marginRight: 8 }}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
};
```

## Features

- ✅ Send up to 5 images per message
- ✅ Backward compatible (old messages with single `image_url` still work)
- ✅ Automatic cleanup on upload failure
- ✅ Unique filenames to prevent collisions
- ✅ Stored in `chat-attachments` Supabase storage bucket
- ✅ Returns sender details with each message

## Limits

- Maximum 5 images per message (configurable in middleware)
- Image size limits defined in `chatImageUpload` middleware
- Supported formats: JPG, PNG, GIF, WebP (as configured in middleware)

## Error Handling

- Invalid chat ID → 400 error
- Upload failure → 500 error with cleanup of partial uploads
- Exceeds image limit → Multer will reject with 400 error

## Storage Structure

Images are stored in Supabase storage:
```
chat-attachments/
  chat-images/
    {userId}-{timestamp}-{random}.{ext}
    {userId}-{timestamp}-{random}.{ext}
    ...
```

## Backward Compatibility

- Old messages with only `image_url` will still display correctly
- Frontend should check for `image_urls` first, fall back to `image_url`
- Single image messages can use either endpoint format
