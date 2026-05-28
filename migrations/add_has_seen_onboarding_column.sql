-- Add has_seen_onboarding column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_onboarding BOOLEAN DEFAULT false;
