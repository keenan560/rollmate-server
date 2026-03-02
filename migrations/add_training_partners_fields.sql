-- Add fields required for training partners functionality

-- Add location fields if they don't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS latitude NUMERIC;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS longitude NUMERIC;

-- Add primary gym field if it doesn't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS primary_gym TEXT;

-- Add availability fields if they don't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS available_now BOOLEAN DEFAULT false;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;

-- Add weight field if it doesn't exist (for matching training partners)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS weight NUMERIC;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_users_available_now 
ON users(available_now) 
WHERE available_now = true;

CREATE INDEX IF NOT EXISTS idx_users_primary_gym 
ON users(primary_gym) 
WHERE primary_gym IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_location 
ON users(latitude, longitude) 
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Add comments to document the columns
COMMENT ON COLUMN users.latitude IS 'User location latitude in decimal degrees (-90 to 90)';
COMMENT ON COLUMN users.longitude IS 'User location longitude in decimal degrees (-180 to 180)';
COMMENT ON COLUMN users.primary_gym IS 'ID or name of user primary training gym';
COMMENT ON COLUMN users.available_now IS 'Boolean flag indicating user is available to train right now';
COMMENT ON COLUMN users.is_online IS 'Boolean flag indicating user is currently online in the app';
COMMENT ON COLUMN users.weight IS 'User weight in pounds (for matching training partners)';
