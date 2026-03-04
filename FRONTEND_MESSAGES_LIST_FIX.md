# Frontend Messages List Duplication Fix

## Problem
The Messages list shows duplicate entries for the same user (e.g., "Keenan Mapp" appears twice) even though there's only ONE chat in the database.

## Root Cause
The Messages list is fetching conversations based on `roll_requests` and showing one entry per roll_request, instead of grouping by unique user pairs.

Example:
- Roll Request 1 (friend request) between User A and User B → Shows "User B" in list
- Roll Request 5 (training partner) between User A and User B → Shows "User B" again in list

Both point to the same chat (chat_id: 2), but appear as separate entries.

## Backend Status
✅ Backend is correct - only ONE chat exists (id: 2)
✅ Backend reuses the same chat for all roll requests between the same users

## Frontend Fix Required

### File: Messages List Screen (likely `src/screens/Messages.tsx` or similar)

The screen is probably fetching conversations like this:

```typescript
// WRONG: Fetches all accepted roll requests
const { data: rollRequests } = await supabase
  .from('roll_requests')
  .select('*, receiver:users(*), sender:users(*)')
  .eq('status', 'accepted')
  .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);

// This creates one entry per roll_request
```

### Solution 1: Deduplicate in Frontend

```typescript
// Fetch all accepted roll requests
const { data: rollRequests } = await supabase
  .from('roll_requests')
  .select('*, receiver:users(*), sender:users(*)')
  .eq('status', 'accepted')
  .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);

// Deduplicate by other user ID
const uniqueConversations = new Map();

rollRequests?.forEach(request => {
  const otherUserId = request.sender_id === userId 
    ? request.receiver_id 
    : request.sender_id;
  
  const otherUser = request.sender_id === userId 
    ? request.receiver 
    : request.sender;
  
  // Only keep the first (oldest) roll request for each user pair
  if (!uniqueConversations.has(otherUserId)) {
    uniqueConversations.set(otherUserId, {
      ...request,
      otherUser,
      otherUserId
    });
  }
});

const conversations = Array.from(uniqueConversations.values());
```

### Solution 2: Fetch Unique Chats Directly (Better)

Instead of fetching roll_requests, fetch chats with user info:

```typescript
// Get all chats where the user is involved
const { data: chats } = await supabase
  .from('chats')
  .select(`
    *,
    roll_request:roll_requests(
      sender_id,
      receiver_id,
      sender:users!sender_id(*),
      receiver:users!receiver_id(*)
    ),
    last_message:chat_messages(
      message,
      created_at,
      sender_id
    )
  `)
  .order('last_message_at', { ascending: false });

// Filter to only chats where current user is involved
const userChats = chats?.filter(chat => {
  const rr = chat.roll_request;
  return rr.sender_id === userId || rr.receiver_id === userId;
});

// Map to conversation format
const conversations = userChats?.map(chat => {
  const rr = chat.roll_request;
  const otherUser = rr.sender_id === userId ? rr.receiver : rr.sender;
  
  return {
    chatId: chat.id,
    rollRequestId: chat.roll_request_id,
    otherUser,
    lastMessage: chat.last_message?.[0],
    lastMessageAt: chat.last_message_at
  };
});
```

### Solution 3: Backend Endpoint (Best)

Create a new backend endpoint that returns unique conversations:

```javascript
// GET /conversations
router.get('/conversations', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  
  try {
    // Get all chats where user is involved
    const { data: chats, error } = await supabase
      .from('chats')
      .select(`
        id,
        roll_request_id,
        last_message_at,
        roll_request:roll_requests!inner(
          sender_id,
          receiver_id,
          status,
          sender:users!sender_id(id, first_name, last_name, avatar_url),
          receiver:users!receiver_id(id, first_name, last_name, avatar_url)
        )
      `)
      .eq('roll_request.status', 'accepted')
      .or(`roll_request.sender_id.eq.${userId},roll_request.receiver_id.eq.${userId}`)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    
    if (error) throw error;
    
    // Map to conversation format
    const conversations = chats.map(chat => {
      const rr = chat.roll_request;
      const otherUser = rr.sender_id === userId ? rr.receiver : rr.sender;
      
      return {
        chatId: chat.id,
        rollRequestId: chat.roll_request_id,
        otherUser,
        lastMessageAt: chat.last_message_at
      };
    });
    
    res.json({ conversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});
```

Then in frontend:
```typescript
const { data } = await fetch('/conversations');
// data.conversations is already deduplicated!
```

## Recommended Approach

Use **Solution 3** (backend endpoint) because:
- ✅ Cleaner frontend code
- ✅ Single source of truth
- ✅ Better performance (one query instead of filtering in frontend)
- ✅ Easier to add features like unread count, last message preview, etc.

## Testing

After implementing the fix:
1. Have multiple roll requests between same users
2. Open Messages list
3. Verify only ONE entry per user appears
4. Tap on the entry
5. Verify it opens the correct chat with all messages

## Summary

- Backend: ✅ Fixed (only one chat per user pair)
- Frontend: ❌ Needs fix (showing duplicate entries)
- Solution: Deduplicate conversations by user pair or fetch chats directly
