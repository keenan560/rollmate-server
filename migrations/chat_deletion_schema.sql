-- Chat & Message Deletion schema
-- Run this migration in Supabase SQL Editor

-- Add soft-delete columns to chat_messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_for_sender BOOLEAN DEFAULT false;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_for_receiver BOOLEAN DEFAULT false;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN DEFAULT false;

-- Deleted chats table (per-user conversation deletion)
CREATE TABLE IF NOT EXISTS deleted_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  deleted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_deleted_chats_user ON deleted_chats(user_id);
