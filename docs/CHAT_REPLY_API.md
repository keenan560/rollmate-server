# Chat Reply API Reference

## Overview
The chat API now fully supports message replies with complete context.

## Endpoints

### POST /chat-messages
Send a new chat message with optional reply.

#### Request Body
```javascript
{
  chatId: number,           // Required: Roll request ID
  message: string,          // Optional: Message text
  reply_to_id: number,      // Optional: ID of message being replied to
  images: File[]            // Optional: Up to 5 image files
}
```

#### Example Request
```javascript
const formData = new FormData();
formData.append('chatId', '123');
formData.append('message', 'Thanks for the help!');
formData.append('reply_to_id', '456'); // Replying to message 456

fetch('/chat-messages', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

#### Response
```json
{
  "id": 789,
  "chat_id": 123,
  "sender_id": "user1",
  "message": "Thanks for the help!",
  "reply_to_id": 456,
  "created_at": "2024-03-15T10:30:00Z",
  "sender": {
    "id": "user1",
    "first_name": "John",
    "last_name": "Doe",
    "avatar_url": "https://..."
  },
  "reply_to": {
    "id": 456,
    "message": "Here's how you do it...",
    "image_url": null,
    "image_urls": null,
    "sender": {
      "id": "user2",
      "first_name": "Jane",
      "last_name": "Smith",
      "avatar_url": "https://..."
    }
  }
}
```

### GET /chat-messages/:rollRequestId
Fetch all messages for a chat, including reply context.

#### Response
```json
{
  "chat": {
    "id": 123,
    "roll_request_id": 456
  },
  "messages": [
    {
      "id": 456,
      "message": "Here's how you do it...",
      "sender_id": "user2",
      "reply_to_id": null,
      "sender": {
        "id": "user2",
        "first_name": "Jane",
        "last_name": "Smith"
      },
      "reply_to": null
    },
    {
      "id": 789,
      "message": "Thanks for the help!",
      "sender_id": "user1",
      "reply_to_id": 456,
      "sender": {
        "id": "user1",
        "first_name": "John",
        "last_name": "Doe"
      },
      "reply_to": {
        "id": 456,
        "message": "Here's how you do it...",
        "sender": {
          "id": "user2",
          "first_name": "Jane",
          "last_name": "Smith"
        }
      }
    }
  ]
}
```

## Reply Context Structure

When a message has a reply, the `reply_to` object includes:
- `id`: Original message ID
- `message`: Original message text
- `image_url`: First image (backward compatibility)
- `image_urls`: All images array
- `sender`: Original sender's user info
  - `id`: User ID
  - `first_name`: First name
  - `last_name`: Last name
  - `avatar_url`: Avatar URL

## Real-time Subscriptions

When subscribing to chat messages via Supabase real-time, use the same select query:

```javascript
supabase
  .channel('chat-messages')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'chat_messages',
      filter: `chat_id=eq.${chatId}`
    },
    (payload) => {
      // payload.new will include reply_to data
      console.log('New message:', payload.new);
    }
  )
  .subscribe();
```

Note: You'll need to manually fetch the reply_to data in subscriptions or use a database function.

## Frontend Usage Example

```typescript
// Sending a reply
const sendReply = async (chatId: number, message: string, replyToId: number) => {
  const formData = new FormData();
  formData.append('chatId', chatId.toString());
  formData.append('message', message);
  formData.append('reply_to_id', replyToId.toString());
  
  const response = await fetch('/chat-messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  return response.json();
};

// Displaying a reply
const MessageWithReply = ({ message }) => {
  return (
    <View>
      {message.reply_to && (
        <View style={styles.replyContext}>
          <Text>{message.reply_to.sender.first_name}</Text>
          <Text>{message.reply_to.message}</Text>
        </View>
      )}
      <Text>{message.message}</Text>
    </View>
  );
};
```

## Database Schema

```sql
-- chat_messages table structure
CREATE TABLE chat_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER REFERENCES chats(id),
  sender_id TEXT REFERENCES users(id),
  message TEXT,
  image_url TEXT,
  image_urls TEXT[],
  reply_to_id INTEGER REFERENCES chat_messages(id),
  reaction TEXT,
  link_preview JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  read_at TIMESTAMP
);

-- Index for better query performance
CREATE INDEX idx_chat_messages_reply_to ON chat_messages(reply_to_id);
```
