-- Belt Verification System Database Schema
-- Run this in your Supabase SQL editor

-- 1. Create belt_verifications table (or alter if exists)
DO $$ 
BEGIN
    -- Create table if it doesn't exist
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'belt_verifications') THEN
        CREATE TABLE belt_verifications (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            belt_level TEXT NOT NULL,
            stripes INTEGER NOT NULL DEFAULT 0,
            promotion_date DATE NOT NULL,
            gym_name TEXT NOT NULL,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    END IF;
    
    -- Add missing columns if table exists
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'belt_verifications' AND column_name = 'status') THEN
        ALTER TABLE belt_verifications ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
    END IF;
    
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'belt_verifications' AND column_name = 'updated_at') THEN
        ALTER TABLE belt_verifications ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- 2. Create belt_verification_endorsements table (or alter if exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'belt_verification_endorsements') THEN
        CREATE TABLE belt_verification_endorsements (
            id SERIAL PRIMARY KEY,
            verification_id INTEGER NOT NULL REFERENCES belt_verifications(id) ON DELETE CASCADE,
            endorser_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            is_instructor BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(verification_id, endorser_user_id)
        );
    END IF;
END $$;

-- 3. Add belt verification fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS belt_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS belt_verified_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_instructor BOOLEAN DEFAULT false;

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_belt_verifications_user_id 
ON belt_verifications(user_id);

CREATE INDEX IF NOT EXISTS idx_belt_verifications_status 
ON belt_verifications(status);

CREATE INDEX IF NOT EXISTS idx_belt_endorsements_verification_id 
ON belt_verification_endorsements(verification_id);

CREATE INDEX IF NOT EXISTS idx_belt_endorsements_endorser_id 
ON belt_verification_endorsements(endorser_user_id);

CREATE INDEX IF NOT EXISTS idx_users_is_instructor 
ON users(is_instructor);

-- 5. Create updated_at trigger for belt_verifications
CREATE OR REPLACE FUNCTION update_belt_verification_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER belt_verification_updated_at
    BEFORE UPDATE ON belt_verifications
    FOR EACH ROW
    EXECUTE FUNCTION update_belt_verification_updated_at();

-- 6. Enable Row Level Security (RLS)
ALTER TABLE belt_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE belt_verification_endorsements ENABLE ROW LEVEL SECURITY;

-- 7. Create RLS Policies

-- Belt Verifications: Users can read all, but only insert their own
DROP POLICY IF EXISTS "Users can view all belt verifications" ON belt_verifications;
CREATE POLICY "Users can view all belt verifications"
ON belt_verifications FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Users can create their own belt verifications" ON belt_verifications;
CREATE POLICY "Users can create their own belt verifications"
ON belt_verifications FOR INSERT
TO authenticated
WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can update their own belt verifications" ON belt_verifications;
CREATE POLICY "Users can update their own belt verifications"
ON belt_verifications FOR UPDATE
TO authenticated
USING (auth.uid()::text = user_id);

-- Belt Verification Endorsements: Users can read all, insert for others
DROP POLICY IF EXISTS "Users can view all endorsements" ON belt_verification_endorsements;
CREATE POLICY "Users can view all endorsements"
ON belt_verification_endorsements FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Users can create endorsements" ON belt_verification_endorsements;
CREATE POLICY "Users can create endorsements"
ON belt_verification_endorsements FOR INSERT
TO authenticated
WITH CHECK (auth.uid()::text = endorser_user_id);

DROP POLICY IF EXISTS "Users can delete their own endorsements" ON belt_verification_endorsements;
CREATE POLICY "Users can delete their own endorsements"
ON belt_verification_endorsements FOR DELETE
TO authenticated
USING (auth.uid()::text = endorser_user_id);

-- 8. Grant permissions
GRANT ALL ON belt_verifications TO authenticated;
GRANT ALL ON belt_verification_endorsements TO authenticated;

-- 9. Comments for documentation
COMMENT ON TABLE belt_verifications IS 'Stores belt promotion verification requests';
COMMENT ON TABLE belt_verification_endorsements IS 'Stores endorsements for belt verifications';
COMMENT ON COLUMN users.belt_verified IS 'Whether the user''s belt has been verified by the community';
COMMENT ON COLUMN users.is_instructor IS 'Whether the user is a BJJ instructor (instructor endorsements have more weight)';
