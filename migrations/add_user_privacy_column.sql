-- Add privacy toggle to users table
ALTER TABLE users ADD COLUMN is_private BOOLEAN DEFAULT false;
