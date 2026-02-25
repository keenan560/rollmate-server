-- Belt Endorsement System Database Schema (LinkedIn-style)
-- Run this in your Supabase SQL editor

-- 1. Create belt_endorsements table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'belt_endorsements') THEN
        CREATE TABLE belt_endorsements (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            endorser_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            belt_level TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(user_id, endorser_user_id, belt_level)
        );
    END IF;
END $$;

-- 2. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_belt_endorsements_user_id 
ON belt_endorsements(user_id);

CREATE INDEX IF NOT EXISTS idx_belt_endorsements_endorser 
ON belt_endorsements(endorser_user_id);

CREATE INDEX IF NOT EXISTS idx_belt_endorsements_belt_level 
ON belt_endorsements(belt_level);

CREATE INDEX IF NOT EXISTS idx_belt_endorsements_user_belt 
ON belt_endorsements(user_id, belt_level);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE belt_endorsements ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies

-- Users can view all endorsements
DROP POLICY IF EXISTS "Users can view all belt endorsements" ON belt_endorsements;
CREATE POLICY "Users can view all belt endorsements"
ON belt_endorsements FOR SELECT
TO authenticated
USING (true);

-- Users can create endorsements for others (not themselves)
DROP POLICY IF EXISTS "Users can create belt endorsements" ON belt_endorsements;
CREATE POLICY "Users can create belt endorsements"
ON belt_endorsements FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid()::text = endorser_user_id 
    AND auth.uid()::text != user_id
);

-- Users can delete their own endorsements
DROP POLICY IF EXISTS "Users can delete their own endorsements" ON belt_endorsements;
CREATE POLICY "Users can delete their own endorsements"
ON belt_endorsements FOR DELETE
TO authenticated
USING (auth.uid()::text = endorser_user_id);

-- 5. Grant permissions
GRANT ALL ON belt_endorsements TO authenticated;

-- 6. Comments for documentation
COMMENT ON TABLE belt_endorsements IS 'LinkedIn-style belt endorsements - users endorse each other''s current belt level';
COMMENT ON COLUMN belt_endorsements.user_id IS 'The user whose belt is being endorsed';
COMMENT ON COLUMN belt_endorsements.endorser_user_id IS 'The user giving the endorsement';
COMMENT ON COLUMN belt_endorsements.belt_level IS 'The belt level being endorsed (must match user''s current belt)';
